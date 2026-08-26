import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
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
  const isProfileSearch = req.method === "GET" && req.path === "/profile-search";
  if (!isEventProfileImport && !isProfileSearch) {
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

router.post("/event-profiles", async (req, res, next): Promise<void> => {
  const event = req.body?.event;
  if (!event?.name) {
    next();
    return;
  }

  const name = String(event.name).trim();
  const city = String(event.city ?? "").trim();
  const region = String(event.region ?? "").trim().toUpperCase();

  try {
    const matches = await db.execute<{ id: string }>(sql`
      select id
      from organizations
      where lower(trim(name)) = lower(trim(${name}))
        and lower(trim(coalesce(city, ''))) = lower(trim(${city}))
        and upper(trim(coalesce(region, ''))) = upper(trim(${region}))
        and consolidated_into_id is null
      limit 2
    `);

    if (matches.rows.length === 0) {
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

    const organizationId = matches.rows[0]!.id;
    const profile = req.body?.profile ?? {};
    const importedContacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const importedBooking = req.body?.booking ?? null;
    const now = new Date();

    const result = await db.transaction(async (transaction) => {
      const organizationValues: Record<string, unknown> = {
        name,
        city: city || null,
        region: region || null,
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
        const inputName = splitName(String(contactInput.name));
        const linkedContacts = await transaction
          .select({
            contactId: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
            email: contacts.email,
            isPrimary: organizationContacts.isPrimary,
          })
          .from(organizationContacts)
          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.active, true)));

        const matchingContact =
          linkedContacts.find((row) => email && row.email?.trim().toLowerCase() === email) ??
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
              travelLegId: importedBooking.travelLegId ?? null,
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