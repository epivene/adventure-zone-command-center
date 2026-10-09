import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { organizations, festivalEditions, contacts, organizationContacts, actContactSyncStates } from "@/db/schema";
import type { FestivalNetDraft, FestivalNetCandidate, FestivalNetImportResult } from "@workspace/api-zod";

type Database = Pick<typeof db, "select" | "insert" | "update" | "execute">;
const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const empty = (value: unknown) => value == null || (typeof value === "string" && !value.trim());
const phoneDigits = (value: string) => value.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "") || null;
const profileKeys = ["city", "region", "address1", "postalCode", "phone", "website"] as const;

export class ImportConflict extends Error {}

/** Re-read inside the transaction: occupied values never become import update targets. */
export function fillMissing(existing: Record<string, unknown>, incoming: Record<string, string>, prefix = "") {
  const values: Record<string, string> = {};
  const filled: string[] = [];
  const preserved: string[] = [];
  for (const [key, value] of Object.entries(incoming)) {
    if (!value.trim() || ["__proto__", "prototype", "constructor"].includes(key)) continue;
    if (empty(existing[key])) { values[key] = value.trim(); filled.push(prefix + key); }
    else if (String(existing[key]).trim() !== value.trim()) preserved.push(prefix + key);
  }
  return { values, filled, preserved };
}

export async function findFestivalNetCandidates(database: Database, draft: FestivalNetDraft): Promise<FestivalNetCandidate[]> {
  const eventId = new URL(draft.sourceUrl).pathname.split("/")[1];
  const sourceMatches = database.select({ organizationId: festivalEditions.organizationId }).from(festivalEditions)
    .where(sql`substring(${festivalEditions.details}->>'sourceUrl' from 'festivalnet[.]com/([0-9]+)') = ${eventId}`);
  const name = normalized(draft.name);
  const records = await database.select().from(organizations).where(and(
    isNull(organizations.consolidatedIntoId),
    or(
      sql`${organizations.id} in (${sourceMatches})`,
      // Ignore punctuation, capitalization and a common suffix. Candidates must be reviewed.
      sql`(regexp_replace(lower(${organizations.name}), '[^a-z0-9]', '', 'g') = ${name}
        and (${draft.region || ""} = '' or ${organizations.region} is null or lower(trim(${organizations.region})) = lower(trim(${draft.region || ""})))
        and (${draft.city || ""} = '' or ${organizations.city} is null or lower(trim(${organizations.city})) = lower(trim(${draft.city || ""}))))`,
      sql`(${draft.city || ""} <> '' and lower(trim(${organizations.city})) = lower(trim(${draft.city || ""}))
        and regexp_replace(lower(${organizations.name}), '[^a-z0-9]', '', 'g') like ${name + "%"})`,
    ),
  )).limit(20);
  const candidates: FestivalNetCandidate[] = [];
  for (const organization of records) {
    const [edition] = await database.select().from(festivalEditions).where(and(
      eq(festivalEditions.organizationId, organization.id), eq(festivalEditions.year, draft.year),
    ));
    const existingFields: Record<string, string> = { name: organization.name };
    for (const key of profileKeys) if (!empty(organization[key])) existingFields[key] = organization[key]!;
    const linked = await database.select({ contact: contacts }).from(organizationContacts)
      .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
      .where(and(eq(organizationContacts.organizationId, organization.id), eq(organizationContacts.active, true)));
    const matchingContact = linked.find(({ contact }) =>
      Boolean(draft.contactEmail && contact.email?.toLowerCase() === draft.contactEmail.toLowerCase()) ||
      Boolean(draft.contactName && normalized(`${contact.firstName} ${contact.lastName}`) === normalized(draft.contactName)),
    )?.contact;
    if (matchingContact) {
      existingFields.contactName = `${matchingContact.firstName} ${matchingContact.lastName}`.trim();
      if (matchingContact.email) existingFields.contactEmail = matchingContact.email;
      if (matchingContact.phone) existingFields.contactPhone = matchingContact.phone;
    }
    candidates.push({ id: organization.id, name: organization.name, city: organization.city, region: organization.region, existingFields, details: edition?.details ?? {} });
  }
  return candidates;
}

export async function applyFestivalNetDraft(draft: FestivalNetDraft, organizationId: string | null): Promise<FestivalNetImportResult> {
  return db.transaction(async tx => {
    // Both identity locks prevent double-clicks/reimports/concurrent uploads creating duplicates.
    const eventId = new URL(draft.sourceUrl).pathname.split("/")[1];
    for (const key of [`festivalnet:event:${eventId}`, `festivalnet:name:${normalized(draft.name)}`].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`);
    }
    const candidates = await findFestivalNetCandidates(tx, draft);
    if (!organizationId && candidates.length) throw new ImportConflict("An existing profile may match this festival. Preview the PDF again and choose that profile instead of creating a duplicate.");
    let organization;
    let created = false;
    const filledFields: string[] = [];
    const preservedFields: string[] = [];
    const incoming = Object.fromEntries(profileKeys.map(key => [key, draft[key] ?? ""]));
    if (organizationId) {
      [organization] = await tx.select().from(organizations).where(eq(organizations.id, organizationId)).for("update");
      if (!organization || organization.consolidatedIntoId) throw new ImportConflict("This profile was removed or merged. Preview again to choose its active profile.");
      const changes = fillMissing(organization, incoming);
      filledFields.push(...changes.filled); preservedFields.push(...changes.preserved);
      if (draft.name.trim() !== organization.name.trim()) preservedFields.push("name");
      if (Object.keys(changes.values).length) {
        await tx.update(organizations).set({
          ...changes.values,
          ...(changes.values.phone ? { normalizedPhone: phoneDigits(changes.values.phone) } : {}),
          updatedAt: new Date(),
        }).where(eq(organizations.id, organization.id));
      }
    } else {
      const fields = fillMissing({}, incoming);
      [organization] = await tx.insert(organizations).values({
        name: draft.name.trim(), placeType: "festival_event", ...fields.values,
        normalizedPhone: phoneDigits(draft.phone ?? ""),
      }).returning();
      if (!organization) throw new Error("Could not create the festival profile.");
      created = true; filledFields.push("name", ...fields.filled);
    }
    const where = and(eq(festivalEditions.organizationId, organization.id), eq(festivalEditions.year, draft.year));
    const [edition] = await tx.select().from(festivalEditions).where(where);
    const changes = fillMissing(edition?.details ?? {}, {
      ...draft.details, sourceUrl: draft.sourceUrl, sourceFilename: draft.sourceFilename,
    }, "details.");
    const details = { ...(edition?.details ?? {}), ...changes.values };
    if (details.startsOn && details.endsOn && details.endsOn < details.startsOn) {
      throw new ImportConflict("The imported dates conflict with this year's saved dates. Review the start and end dates before importing; no changes were saved.");
    }
    if (edition && Object.keys(changes.values).length) {
      await tx.update(festivalEditions).set({ details, updatedAt: new Date(Math.max(Date.now(), edition.updatedAt.getTime() + 1)) }).where(where);
    } else if (!edition) await tx.insert(festivalEditions).values({ organizationId: organization.id, year: draft.year, details });
    filledFields.push(...changes.filled); preservedFields.push(...changes.preserved);

    if (draft.contactName?.trim()) {
      const nameParts = draft.contactName.trim().split(/\s+/);
      const firstName = nameParts.shift()!; const lastName = nameParts.join(" ");
      const linked = await tx.select({ contact: contacts }).from(organizationContacts)
        .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
        .where(eq(organizationContacts.organizationId, organization.id));
      let contact = linked.find(({ contact }) =>
        Boolean(draft.contactEmail && contact.email?.toLowerCase() === draft.contactEmail.toLowerCase()) ||
        normalized(`${contact.firstName} ${contact.lastName}`) === normalized(draft.contactName!),
      )?.contact;
      // A director already saved for another festival can be linked without changing their identity.
      if (!contact && draft.contactEmail) {
        [contact] = await tx.select().from(contacts).where(and(
          sql`lower(${contacts.email}) = ${draft.contactEmail.toLowerCase()}`,
          sql`regexp_replace(lower(${contacts.firstName} || ${contacts.lastName}), '[^a-z0-9]', '', 'g') = ${normalized(draft.contactName)}`,
        )).limit(1);
      }
      if (contact) {
        // Another profile may reference this contact: calculate missing values under its row lock.
        [contact] = await tx.select().from(contacts).where(eq(contacts.id, contact.id)).for("update");
        const update = fillMissing({ contactEmail: contact.email, contactPhone: contact.phone }, {
          contactEmail: draft.contactEmail ?? "", contactPhone: draft.contactPhone ?? "",
        });
        if (Object.keys(update.values).length) {
          await tx.update(contacts).set({
            ...(update.values.contactEmail ? { email: update.values.contactEmail.toLowerCase() } : {}),
            ...(update.values.contactPhone ? { phone: update.values.contactPhone, normalizedPhone: phoneDigits(update.values.contactPhone) } : {}),
            updatedAt: new Date(),
          }).where(eq(contacts.id, contact.id));
          await tx.insert(actContactSyncStates).values({ contactId: contact.id, localDirty: true, state: "waiting" })
            .onConflictDoUpdate({ target: actContactSyncStates.contactId, set: { localDirty: true, state: "waiting", updatedAt: new Date() } });
        }
        filledFields.push(...update.filled); preservedFields.push(...update.preserved);
        if (normalized(`${contact.firstName} ${contact.lastName}`) !== normalized(draft.contactName)) preservedFields.push("contactName");
      } else {
        [contact] = await tx.insert(contacts).values({
          firstName, lastName, email: draft.contactEmail?.toLowerCase() || null,
          phone: draft.contactPhone || null, normalizedPhone: phoneDigits(draft.contactPhone ?? ""),
          jobTitle: "Show director",
        }).returning();
        filledFields.push("contactName");
        if (draft.contactEmail) filledFields.push("contactEmail");
        if (draft.contactPhone) filledFields.push("contactPhone");
        await tx.insert(actContactSyncStates).values({ contactId: contact.id, localDirty: true, state: "waiting" });
      }
      if (!linked.some(item => item.contact.id === contact.id)) {
        // Do not replace the current primary contact.
        const hasPrimary = linked.some(item => item.contact != null) &&
          (await tx.select().from(organizationContacts).where(and(
            eq(organizationContacts.organizationId, organization.id), eq(organizationContacts.isPrimary, true), eq(organizationContacts.active, true),
          ))).length > 0;
        await tx.insert(organizationContacts).values({
          organizationId: organization.id, contactId: contact.id, role: "Show director",
          isPrimary: !hasPrimary, active: true, source: "festivalnet",
        });
      }
    }
    return { organizationId: organization.id, created, filledFields, preservedFields };
  });
}
