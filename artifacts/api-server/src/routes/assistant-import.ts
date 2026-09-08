import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { importedTravelLegPatch } from "@/features/approved-profile-import/imported-travel-leg";
import {
  bookingContacts,
  bookings,
  contacts,
  organizationContacts,
  organizations,
} from "@/db/schema";
import { PostgresProfileSearchRepository } from "@/features/assistant/profile-search-repository";
import { parseBusinessDateInput } from "@/lib/business-date";
import eventProfilesRouter from "./event-profiles";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const router: IRouter = Router();
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizedPhone(value: string | null | undefined) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits || null;
}

function splitName(name: string) {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

router.use(requireAssistantImportToken);
router.use((req, res, next) => {
  const isEventProfileImport = req.method === "POST" && req.path === "/event-profiles";
  const isProfileContactUpsert = req.method === "POST" && req.path === "/profile-contacts";
  const isProfileSearch = req.method === "GET" && req.path === "/profile-search";
  if (!isEventProfileImport && !isProfileContactUpsert && !isProfileSearch) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  next();
});

router.get("/profile-search", async (req, res): Promise<void> => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (query.length < 2) {
    res.status(400).json({ ok: false, error: "Enter at least 2 characters to search profiles." });
    return;
  }

  const requestedLimit = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : 8;
  const limit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(requestedLimit, 20)) : 8;

  try {
    const repository = new PostgresProfileSearchRepository();
    const results = await repository.search({ query, limit });
    res.json({ ok: true, query, results });
  } catch (error) {
    req.log.error({ err: error, query }, "Failed assistant-import profile search");
    res.status(500).json({ ok: false, error: "Profile search failed." });
  }
});

router.post("/profile-contacts", async (req, res): Promise<void> => {
  const organizationId = typeof req.body?.organizationId === "string" ? req.body.organizationId.trim() : "";
  const input = req.body?.contact ?? {};
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const phone = typeof input.phone === "string" ? input.phone.trim() : "";
  const role = typeof input.role === "string" ? input.role.trim() : "";
  const requestedContactId = typeof input.id === "string" && uuidPattern.test(input.id.trim()) ? input.id.trim() : null;
  const makePrimary = Boolean(input.primary);

  if (!uuidPattern.test(organizationId) || !name || (email && !email.includes("@"))) {
    res.status(400).json({ ok: false, error: "Review the profile and contact details." });
    return;
  }

  try {
    const now = new Date();
    const result = await db.transaction(async (transaction) => {
      const [organization] = await transaction
        .select({ id: organizations.id })
        .from(organizations)
        .where(and(eq(organizations.id, organizationId), sql`${organizations.consolidatedIntoId} is null`))
        .limit(1);
      if (!organization) return null;

      let existingContact: { id: string } | undefined;
      if (requestedContactId) {
        [existingContact] = await transaction
          .select({ id: contacts.id })
          .from(contacts)
          .where(eq(contacts.id, requestedContactId))
          .limit(1);
      } else if (email) {
        [existingContact] = await transaction
          .select({ id: contacts.id })
          .from(contacts)
          .where(sql`lower(trim(coalesce(${contacts.email}, ''))) = ${email}`)
          .orderBy(asc(contacts.createdAt), asc(contacts.id))
          .limit(1);
      }

      const split = splitName(name);
      let contactId: string;
      if (existingContact) {
        contactId = existingContact.id;
        await transaction
          .update(contacts)
          .set({
            firstName: split.firstName,
            lastName: split.lastName,
            email: email || null,
            phone: phone || null,
            normalizedPhone: normalizedPhone(phone),
            jobTitle: role || null,
            updatedAt: now,
          })
          .where(eq(contacts.id, contactId));
      } else {
        const [created] = await transaction
          .insert(contacts)
          .values({
            firstName: split.firstName,
            lastName: split.lastName,
            email: email || null,
            phone: phone || null,
            normalizedPhone: normalizedPhone(phone),
            jobTitle: role || null,
            createdAt: now,
            updatedAt: now,
          })
          .returning({ id: contacts.id });
        if (!created) throw new Error("CONTACT_CREATE_FAILED");
        contactId = created.id;
      }

      if (makePrimary) {
        await transaction
          .update(organizationContacts)
          .set({ isPrimary: false, updatedAt: now })
          .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.active, true)));
      }

      const [relationship] = await transaction
        .select({ id: organizationContacts.id })
        .from(organizationContacts)
        .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.contactId, contactId)))
        .limit(1);
      if (relationship) {
        await transaction
          .update(organizationContacts)
          .set({ role: role || null, isPrimary: makePrimary, active: true, updatedAt: now })
          .where(eq(organizationContacts.id, relationship.id));
      } else {
        await transaction.insert(organizationContacts).values({
          organizationId,
          contactId,
          role: role || null,
          isPrimary: makePrimary,
          active: true,
          source: "local",
          createdAt: now,
          updatedAt: now,
        });
      }

      return { contactId, created: !existingContact };
    });

    if (!result) {
      res.status(404).json({ ok: false, error: "Profile not found." });
      return;
    }
    res.status(result.created ? 201 : 200).json({ ok: true, organizationId, ...result, primary: makePrimary });
  } catch (error) {
    req.log.error({ err: error, organizationId }, "Failed assistant profile contact upsert");
    res.status(500).json({ ok: false, error: "The profile contact could not be saved." });
  }
});

router.post("/event-profiles", async (req, res, next): Promise<void> => {
  const event = req.body?.event;
  if (!event?.name) {
    next();
    return;
  }

  const name = String(event.name).trim();
  const city = String(event.city ?? "").trim();
  const region = String(event.region ?? "").trim().toUpperCase();
  const requestedProfileId = typeof event.id === "string" && uuidPattern.test(event.id.trim())
    ? event.id.trim()
    : null;

  try {
    type ExistingProfileRow = { id: string; name: string; city: string | null; region: string | null };
    const matches = requestedProfileId
      ? await db.execute<ExistingProfileRow>(sql`
          select id, name, city, region
          from organizations
          where id = ${requestedProfileId}::uuid
            and consolidated_into_id is null
          limit 1
        `)
      : await db.execute<ExistingProfileRow>(sql`
          select id, name, city, region
          from organizations
          where lower(trim(name)) = lower(trim(${name}))
            and lower(trim(coalesce(city, ''))) = lower(trim(${city}))
            and upper(trim(coalesce(region, ''))) = upper(trim(${region}))
            and consolidated_into_id is null
          limit 2
        `);

    if (matches.rows.length === 0) {
      if (requestedProfileId) {
        res.status(404).json({ ok: false, error: "The resolved event profile no longer exists." });
        return;
      }
      next();
      return;
    }

    if (matches.rows.length > 1) {
      res.status(409).json({
        ok: false,
        error: "More than one existing profile matches this event name and location.",
      });
      return;
    }

    const existingProfile = matches.rows[0]!;
    const organizationId = existingProfile.id;
    const profile = req.body?.profile ?? {};
    const importedContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const importedBooking = req.body?.booking ?? null;
    const now = new Date();

    const result = await db.transaction(async (transaction) => {
      const renameExisting = requestedProfileId && req.body?.renameExisting === true;
      const organizationValues: Record<string, unknown> = {
        ...(requestedProfileId && !renameExisting ? {} : { name }),
        city: city || existingProfile.city || null,
        region: region || existingProfile.region || null,
        updatedAt: now,
      };
      if (typeof profile.placeType === "string" && profile.placeType.trim()) organizationValues.placeType = profile.placeType.trim();
      if (typeof profile.phone === "string") {
        organizationValues.phone = profile.phone.trim() || null;
        organizationValues.normalizedPhone = normalizedPhone(profile.phone);
      }
      if (typeof profile.website === "string") organizationValues.website = profile.website.trim() || null;
      if (typeof profile.address1 === "string") organizationValues.address1 = profile.address1.trim() || null;
      if (typeof profile.address2 === "string") organizationValues.address2 = profile.address2.trim() || null;
      if (typeof profile.postalCode === "string") organizationValues.postalCode = profile.postalCode.trim() || null;

      await transaction.update(organizations).set(organizationValues as any).where(eq(organizations.id, organizationId));

      if (typeof profile.description === "string") {
        await transaction.execute(sql.raw("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text"));
        await transaction.execute(sql`update organizations set description = ${profile.description.trim() || null} where id = ${organizationId}::uuid`);
      }

      let contactId: string | null = null;
      const contactInput = importedContacts.find((contact: any) => contact?.primary) ?? importedContacts[0];
      if (contactInput?.name) {
        const email = String(contactInput.email ?? "").trim().toLowerCase();
        const inputPhone = normalizedPhone(String(contactInput.phone ?? ""));
        const inputName = splitName(String(contactInput.name));
        const linkedContacts = await transaction
          .select({
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            normalizedPhone: contacts.normalizedPhone,
            isPrimary: organizationContacts.isPrimary,
          })
          .from(organizationContacts)
          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(
            eq(organizationContacts.organizationId, organizationId),
            eq(organizationContacts.active, true),
            sql`not exists (
              select 1 from contact_consolidations cc
              where cc.source_contact_id = ${contacts.id}
            )`,
          ))
          .orderBy(desc(organizationContacts.isPrimary), asc(contacts.createdAt), asc(contacts.id));

        const matchingContact =
          linkedContacts.find((row) => email && row.email?.trim().toLowerCase() === email) ??
          linkedContacts.find((row) => inputPhone && normalizedPhone(row.normalizedPhone) === inputPhone) ??
          linkedContacts.find((row) =>
            `${row.firstName} ${row.lastName}`.trim().toLowerCase() === String(contactInput.name).trim().toLowerCase(),
          ) ??
          linkedContacts.find((row) => row.isPrimary) ??
          null;

        if (matchingContact) {
          contactId = matchingContact.contactId;
          await transaction
            .update(contacts)
            .set({
              firstName: inputName.firstName,
              lastName: inputName.lastName,
              email: email || null,
              phone: String(contactInput.phone ?? "").trim() || null,
              normalizedPhone: normalizedPhone(String(contactInput.phone ?? "")),
              jobTitle: String(contactInput.role ?? "").trim() || null,
              updatedAt: now,
            })
            .where(eq(contacts.id, contactId));
        } else {
          const [created] = await transaction
            .insert(contacts)
            .values({
              firstName: inputName.firstName,
              lastName: inputName.lastName,
              email: email || null,
              phone: String(contactInput.phone ?? "").trim() || null,
              normalizedPhone: normalizedPhone(String(contactInput.phone ?? "")),
              jobTitle: String(contactInput.role ?? "").trim() || null,
              createdAt: now,
              updatedAt: now,
            })
            .returning({ id: contacts.id });
          contactId = created?.id ?? null;
        }

        if (contactId) {
          if (contactInput.primary) {
            await transaction
              .update(organizationContacts)
              .set({ isPrimary: false, updatedAt: now })
              .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.active, true)));
          }
          const [existingRelationship] = await transaction
            .select({ id: organizationContacts.id })
            .from(organizationContacts)
            .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.contactId, contactId)))
            .limit(1);
          if (existingRelationship) {
            await transaction
              .update(organizationContacts)
              .set({
                role: String(contactInput.role ?? "").trim() || null,
                isPrimary: Boolean(contactInput.primary),
                active: true,
                updatedAt: now,
              })
              .where(eq(organizationContacts.id, existingRelationship.id));
          } else {
            await transaction.insert(organizationContacts).values({
              organizationId,
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
        const [existingBooking] = await transaction
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.organizationId, organizationId), eq(bookings.name, bookingName)))
          .orderBy(
            sql`case when coalesce(${bookings.notes}, '') like '[Merged duplicate] Canonical booking:%' then 1 else 0 end`,
            desc(sql`case when ${bookings.startsAt} is not null then 1 else 0 end`),
            asc(bookings.createdAt),
            asc(bookings.id),
          )
          .limit(1);

        if (existingBooking) {
          bookingId = existingBooking.id;
          await transaction
            .update(bookings)
            .set({
              city,
              region,
              postalCode: String(profile.postalCode ?? "").trim() || null,
              address1: String(profile.address1 ?? "").trim() || null,
              startsAt,
              endsAt,
              status: importedBooking.status ?? "new_lead",
              ...importedTravelLegPatch(importedBooking.travelLegId),
              updatedAt: now,
            } as any)
            .where(eq(bookings.id, bookingId));
        } else {
          const [createdBooking] = await transaction
            .insert(bookings)
            .values({
              organizationId,
              name: bookingName,
              city,
              region,
              postalCode: String(profile.postalCode ?? "").trim() || null,
              address1: String(profile.address1 ?? "").trim() || null,
              startsAt,
              endsAt,
              status: importedBooking.status ?? "new_lead",
              travelLegId: importedBooking.travelLegId ?? null,
              createdAt: now,
              updatedAt: now,
            } as any)
            .returning({ id: bookings.id });
          bookingId = createdBooking?.id ?? null;
        }

        if (bookingId && contactId) {
          await transaction
            .update(bookingContacts)
            .set({ isPrimary: false, updatedAt: now })
            .where(eq(bookingContacts.bookingId, bookingId));
          const [existingBookingContact] = await transaction
            .select({ id: bookingContacts.id })
            .from(bookingContacts)
            .where(and(eq(bookingContacts.bookingId, bookingId), eq(bookingContacts.contactId, contactId)))
            .limit(1);
          if (existingBookingContact) {
            await transaction
              .update(bookingContacts)
              .set({
                role: String(contactInput?.role ?? "").trim() || null,
                isPrimary: true,
                updatedAt: now,
              })
              .where(eq(bookingContacts.id, existingBookingContact.id));
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

      return { bookingId, contactId };
    });

    res.json({
      ok: true,
      action: "updated",
      profileId: organizationId,
      bookingId: result.bookingId,
      contactId: result.contactId,
    });
  } catch (error) {
    req.log.error({ err: error }, "Failed to upsert assistant-import event profile");
    res.status(500).json({ ok: false, error: "The approved profile import could not be applied." });
  }
});

router.use(eventProfilesRouter);

export default router;