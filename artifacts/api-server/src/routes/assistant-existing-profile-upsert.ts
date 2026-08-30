import { and, eq, isNull, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

import { db } from "@workspace/db";
import {
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { parseBusinessDateInput } from "@/lib/business-date";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

const promotableToConfirmed = new Set([
  "new_lead",
  "researching",
  "contact_due",
  "contacted",
  "interested",
  "possible",
  "unlikely",
  "quote_sent",
  "pending_decision",
  "pending_contract",
  "contract_received",
  "renewal_due",
]);

function normalizedPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits || null;
}

function normalizedName(value: string | null | undefined) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "").trim();
}

function splitName(name: string) {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

function importedStatus(existing: string, requested: unknown) {
  if (typeof requested !== "string" || !requested.trim()) return existing;
  const next = requested.trim();
  if (existing === next) return existing;
  if (existing === "completed") return existing;
  if (next === "confirmed" && promotableToConfirmed.has(existing)) return next;
  if (next === "completed" && (promotableToConfirmed.has(existing) || existing === "confirmed")) return next;
  if ((next === "declined" || next === "cancelled") && existing !== "confirmed") return next;
  if (promotableToConfirmed.has(existing) && promotableToConfirmed.has(next)) return next;
  return existing;
}

router.use(requireAssistantImportToken);

// The startup resolver supplies event.id after matching aliases and exact profile
// evidence. Handle those imports here before the older name-only import route so an
// alias can never create another profile/contact/appearance shell.
router.post("/event-profiles", async (req, res, next): Promise<void> => {
  const event = req.body?.event;
  const profileId = typeof event?.id === "string" ? event.id.trim() : "";
  if (!profileId) {
    next();
    return;
  }
  if (!UUID_PATTERN.test(profileId)) {
    res.status(400).json({ ok: false, error: "The reviewed profile ID is invalid." });
    return;
  }

  const [profileRecord] = await db
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      region: organizations.region,
    })
    .from(organizations)
    .where(and(eq(organizations.id, profileId), isNull(organizations.consolidatedIntoId)))
    .limit(1);
  if (!profileRecord) {
    res.status(404).json({ ok: false, error: "The reviewed profile no longer exists." });
    return;
  }

  const profile = req.body?.profile ?? {};
  const importedContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
  const importedBooking = req.body?.booking ?? null;
  const eventCity = String(event?.city ?? profileRecord.city ?? "").trim();
  const eventRegion = String(event?.region ?? profileRecord.region ?? "").trim().toUpperCase();
  const now = new Date();

  try {
    const result = await db.transaction(async (transaction) => {
      const organizationValues: Record<string, unknown> = { updatedAt: now };
      if (typeof profile.placeType === "string" && profile.placeType.trim()) organizationValues.placeType = profile.placeType.trim();
      if (typeof profile.phone === "string" && profile.phone.trim()) {
        organizationValues.phone = profile.phone.trim();
        organizationValues.normalizedPhone = normalizedPhone(profile.phone);
      }
      if (typeof profile.website === "string" && profile.website.trim()) organizationValues.website = profile.website.trim();
      if (typeof profile.address1 === "string" && profile.address1.trim()) organizationValues.address1 = profile.address1.trim();
      if (typeof profile.address2 === "string") organizationValues.address2 = profile.address2.trim() || null;
      if (typeof profile.postalCode === "string" && profile.postalCode.trim()) organizationValues.postalCode = profile.postalCode.trim();
      if (!profileRecord.city && eventCity) organizationValues.city = eventCity;
      if (!profileRecord.region && eventRegion) organizationValues.region = eventRegion;

      await transaction.update(organizations).set(organizationValues as any).where(eq(organizations.id, profileId));

      if (typeof profile.description === "string" && profile.description.trim()) {
        await transaction.execute(sql.raw("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text"));
        await transaction.execute(sql`
          update organizations
             set description = ${profile.description.trim()}, updated_at = ${now}
           where id = ${profileId}::uuid
        `);
      }

      let contactId: string | null = null;
      const contactInput = importedContacts.find((contact: any) => contact?.primary) ?? importedContacts[0];
      if (contactInput?.name) {
        const name = String(contactInput.name).trim();
        const email = String(contactInput.email ?? "").trim().toLowerCase();
        const phone = String(contactInput.phone ?? "").trim();
        const phoneKey = normalizedPhone(phone);
        const nameKey = normalizedName(name);
        const inputName = splitName(name);

        const linkedContacts = await transaction
          .select({
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            phone: contacts.phone,
            normalizedPhone: contacts.normalizedPhone,
          })
          .from(organizationContacts)
          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(
            eq(organizationContacts.organizationId, profileId),
            eq(organizationContacts.active, true),
          ));

        const exactMatches = linkedContacts.filter((row) => {
          const rowEmail = row.email?.trim().toLowerCase() ?? "";
          const rowPhone = row.normalizedPhone ?? normalizedPhone(row.phone);
          const rowName = normalizedName(`${row.firstName} ${row.lastName}`);
          return Boolean(
            (email && rowEmail === email)
            || (phoneKey && rowPhone === phoneKey)
            || (nameKey && rowName === nameKey),
          );
        });
        if (exactMatches.length > 1) {
          throw new Error("APPROVED_PROFILE_CONTACT_MATCH_AMBIGUOUS");
        }

        const matchingContact = exactMatches[0] ?? null;
        if (matchingContact) {
          contactId = matchingContact.contactId;
          await transaction.update(contacts).set({
            firstName: inputName.firstName || matchingContact.firstName,
            lastName: inputName.lastName || matchingContact.lastName,
            email: email || matchingContact.email,
            phone: phone || matchingContact.phone,
            normalizedPhone: phoneKey || matchingContact.normalizedPhone,
            jobTitle: String(contactInput.role ?? "").trim() || undefined,
            updatedAt: now,
          } as any).where(eq(contacts.id, contactId));
        } else {
          const [created] = await transaction.insert(contacts).values({
            firstName: inputName.firstName,
            lastName: inputName.lastName,
            email: email || null,
            phone: phone || null,
            normalizedPhone: phoneKey,
            jobTitle: String(contactInput.role ?? "").trim() || null,
            createdAt: now,
            updatedAt: now,
          }).returning({ id: contacts.id });
          contactId = created?.id ?? null;
        }

        if (contactId) {
          if (contactInput.primary) {
            await transaction.update(organizationContacts).set({
              isPrimary: false,
              updatedAt: now,
            }).where(and(
              eq(organizationContacts.organizationId, profileId),
              eq(organizationContacts.active, true),
            ));
          }

          const [relationship] = await transaction
            .select({ id: organizationContacts.id })
            .from(organizationContacts)
            .where(and(
              eq(organizationContacts.organizationId, profileId),
              eq(organizationContacts.contactId, contactId),
            ))
            .limit(1);
          if (relationship) {
            await transaction.update(organizationContacts).set({
              role: String(contactInput.role ?? "").trim() || null,
              isPrimary: Boolean(contactInput.primary),
              active: true,
              updatedAt: now,
            }).where(eq(organizationContacts.id, relationship.id));
          } else {
            await transaction.insert(organizationContacts).values({
              organizationId: profileId,
              contactId,
              role: String(contactInput.role ?? "").trim() || null,
              isPrimary: Boolean(contactInput.primary),
              active: true,
              source: "local",
              createdAt: now,
              updatedAt: now,
            });
          }
        }
      }

      let bookingId: string | null = null;
      if (importedBooking?.enabled && importedBooking?.name) {
        const bookingName = String(importedBooking.name).trim();
        const startsAt = importedBooking.startsAt ? parseBusinessDateInput(String(importedBooking.startsAt)) : null;
        const endsAt = importedBooking.endsAt ? parseBusinessDateInput(String(importedBooking.endsAt)) : null;
        const candidates = await transaction.execute<{
          id: string;
          name: string;
          status: string;
          travel_leg_id: string | null;
          starts_at: Date | null;
          ends_at: Date | null;
        }>(sql`
          select b.id::text, b.name, b.status::text, b.travel_leg_id,
                 b.starts_at, b.ends_at
            from bookings b
           where b.organization_id = ${profileId}::uuid
             and not exists (
               select 1 from booking_consolidations retired
                where retired.source_booking_id = b.id
             )
           order by b.updated_at desc, b.id
        `);

        const byName = candidates.rows.filter((row) => row.name.trim().toLowerCase() === bookingName.toLowerCase());
        const byDate = startsAt
          ? candidates.rows.filter((row) =>
              row.starts_at
              && row.starts_at.toISOString().slice(0, 10) === startsAt.toISOString().slice(0, 10)
              && (!endsAt || !row.ends_at || row.ends_at.toISOString().slice(0, 10) === endsAt.toISOString().slice(0, 10)),
            )
          : [];
        const matches = byName.length ? byName : byDate;
        if (matches.length > 1) throw new Error("APPROVED_PROFILE_APPEARANCE_MATCH_AMBIGUOUS");

        const existing = matches[0] ?? null;
        if (existing) {
          bookingId = existing.id;
          await transaction.update(bookings).set({
            city: eventCity || undefined,
            region: eventRegion || undefined,
            postalCode: String(profile.postalCode ?? "").trim() || undefined,
            address1: String(profile.address1 ?? "").trim() || undefined,
            startsAt: startsAt ?? existing.starts_at,
            endsAt: endsAt ?? existing.ends_at,
            status: importedStatus(existing.status, importedBooking.status),
            travelLegId: importedBooking.travelLegId ?? existing.travel_leg_id,
            updatedAt: now,
          } as any).where(eq(bookings.id, bookingId));
        } else {
          const [created] = await transaction.insert(bookings).values({
            organizationId: profileId,
            name: bookingName,
            city: eventCity,
            region: eventRegion,
            postalCode: String(profile.postalCode ?? "").trim() || null,
            address1: String(profile.address1 ?? "").trim() || null,
            startsAt,
            endsAt,
            status: typeof importedBooking.status === "string" ? importedBooking.status : "new_lead",
            travelLegId: importedBooking.travelLegId ?? null,
            createdAt: now,
            updatedAt: now,
          } as any).returning({ id: bookings.id });
          bookingId = created?.id ?? null;
        }

        if (bookingId && contactId) {
          await transaction.update(bookingContacts).set({
            isPrimary: false,
            updatedAt: now,
          }).where(eq(bookingContacts.bookingId, bookingId));
          const [relationship] = await transaction
            .select({ id: bookingContacts.id })
            .from(bookingContacts)
            .where(and(eq(bookingContacts.bookingId, bookingId), eq(bookingContacts.contactId, contactId)))
            .limit(1);
          if (relationship) {
            await transaction.update(bookingContacts).set({
              role: String(contactInput?.role ?? "").trim() || null,
              isPrimary: true,
              updatedAt: now,
            }).where(eq(bookingContacts.id, relationship.id));
          } else {
            await transaction.insert(bookingContacts).values({
              bookingId,
              contactId,
              role: String(contactInput?.role ?? "").trim() || null,
              isPrimary: true,
              source: "local",
              createdAt: now,
              updatedAt: now,
            });
          }
          await transaction.update(bookings).set({ primaryContactId: contactId, updatedAt: now }).where(eq(bookings.id, bookingId));
        }
      }

      return { contactId, bookingId };
    });

    res.json({
      ok: true,
      action: "updated_existing_profile",
      profileId,
      profileName: profileRecord.name,
      contactId: result.contactId,
      bookingId: result.bookingId,
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "APPROVED_PROFILE_CONTACT_MATCH_AMBIGUOUS" || code === "APPROVED_PROFILE_APPEARANCE_MATCH_AMBIGUOUS") {
      res.status(409).json({ ok: false, error: "The reviewed import matched more than one active record and was not applied." });
      return;
    }
    req.log.error({ err: error, profileId }, "Failed existing-profile approved import");
    res.status(500).json({ ok: false, error: "The reviewed profile import could not be applied safely." });
  }
});

export default router;
