import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  actContactSyncStates,
  bookingContacts,
  bookings,
  contacts,
  followUps,
  organizationContacts,
  organizations,
  eventManagerReviews,
  eventFamilies,
  eventFamilyMembers,
} from "@/db/schema";
import { DrizzleEventProfileRepository } from "@/features/event-profiles/event-profile-repository";
import { getOrganizationMembershipContext } from "@/features/organizations/organization-membership-query";
import { ensurePlacePersonRelationship } from "@/features/relationships/relationship-writer";
import { parseBusinessDateInput } from "@/lib/business-date";

const router: IRouter = Router();

const uuid = z.string().uuid();
const profilePlaceType = z.enum(["fair", "city_government", "festival_event", "venue", "school", "tribe", "association", "company", "other"]);
const bookingStatus = z.enum([
  "new_lead", "researching", "contact_due", "contacted", "interested", "possible", "unlikely",
  "quote_sent", "pending_decision", "pending_contract", "contract_received", "confirmed", "declined",
  "cancelled", "completed", "renewal_due",
]);
const creationSchema = z.object({
  event: z.object({ id: z.string().nullable(), name: z.string(), city: z.string(), region: z.string() }),
  profile: z.object({
    placeType: profilePlaceType.default("festival_event"),
    description: z.string().max(5000).default(""),
    phone: z.string().default(""),
    website: z.string().default(""),
    address1: z.string().default(""),
    address2: z.string().default(""),
    postalCode: z.string().default(""),
  }).optional().default({ placeType: "festival_event", description: "", phone: "", website: "", address1: "", address2: "", postalCode: "" }),
  contacts: z.array(z.object({ id: z.string().nullable(), name: z.string(), phone: z.string(), email: z.string(), role: z.string(), primary: z.boolean().optional() })).default([]),
  booking: z.object({
    enabled: z.boolean(),
    name: z.string(),
    status: bookingStatus.optional().default("new_lead"),
    startsAt: z.string().optional().default(""),
    endsAt: z.string().optional().default(""),
    nextActionKind: z.string(),
    nextActionDueAt: z.string(),
    travelLegId: z.string().uuid().nullable(),
  }),
  familyId: z.string().uuid().nullable().optional().default(null),
  parentOrganizationId: z.string().uuid().nullable().optional().default(null),
}).superRefine((input, context) => {
  const selectedIds = input.contacts.map((contact) => contact.id).filter((id): id is string => Boolean(id));
  if (new Set(selectedIds).size !== selectedIds.length) context.addIssue({ code: "custom", message: "Choose each existing contact only once." });
  if (input.event.id ? !uuid.safeParse(input.event.id).success : !input.event.name.trim()) context.addIssue({ code: "custom", message: "Enter a profile name." });
  if (input.event.region.trim() && input.event.region.trim().length !== 2) context.addIssue({ code: "custom", message: "Use a two-letter state when a state is entered." });
  for (const contact of input.contacts) {
    if (contact.id ? !uuid.safeParse(contact.id).success : !contact.name.trim()) context.addIssue({ code: "custom", message: "Choose a contact or enter a contact name." });
    if (contact.email.trim() && !z.email().safeParse(contact.email.trim()).success) context.addIssue({ code: "custom", message: "Enter a valid contact email address." });
  }
  if (input.booking.enabled && (!input.booking.name.trim() || !parseBusinessDateInput(input.booking.nextActionDueAt))) {
    context.addIssue({ code: "custom", message: "Enter a booking name and next follow-up date." });
  }
  const startsAt = input.booking.startsAt ? parseBusinessDateInput(input.booking.startsAt) : null;
  const endsAt = input.booking.endsAt ? parseBusinessDateInput(input.booking.endsAt) : null;
  if (input.booking.startsAt && !startsAt) context.addIssue({ code: "custom", message: "Enter a valid event start date." });
  if (input.booking.endsAt && !endsAt) context.addIssue({ code: "custom", message: "Enter a valid event end date." });
  if (startsAt && endsAt && endsAt.getTime() < startsAt.getTime()) context.addIssue({ code: "custom", message: "Event end date cannot be before the start date." });
});

const nullableProfileText = z
  .union([z.string(), z.null()])
  .transform((value) => value?.trim() || null);

const editProfileSchema = z.object({
  name: z.string().trim().min(1, "Add a profile name."),
  phone: nullableProfileText,
  address1: nullableProfileText,
  address2: nullableProfileText,
  city: nullableProfileText,
  region: nullableProfileText,
  postalCode: nullableProfileText,
  website: nullableProfileText,
}).strict();

function normalizedPhone(value: string | null) {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits || null;
}

function splitName(name: string) {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

router.get("/event-profiles/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const contactId = req.query.contactId as string | undefined;
  try {
    const repo = new DrizzleEventProfileRepository(db);
    const profile = await repo.getEventProfile(id, contactId);
    if (!profile) { res.status(404).json({ error: "Not found" }); return; }
    const manualOrganizationContext = await getOrganizationMembershipContext(db, id);
    const [membership] = await db
      .select({ familyId: eventFamilyMembers.familyId, familyName: eventFamilies.name })
      .from(eventFamilyMembers)
      .innerJoin(eventFamilies, eq(eventFamilies.id, eventFamilyMembers.familyId))
      .where(eq(eventFamilyMembers.organizationId, id))
      .limit(1);
    const [organizationContext] = await db
      .select({ consolidatedIntoId: organizations.consolidatedIntoId })
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);
    let familyContext: { kind: "event_family" | "organization_group"; id: string; name: string } | null = membership
      ? { kind: "event_family", id: membership.familyId, name: membership.familyName }
      : null;
    if (!familyContext && organizationContext?.consolidatedIntoId) {
      const [parent] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, organizationContext.consolidatedIntoId)).limit(1);
      if (parent) familyContext = { kind: "organization_group", id: parent.id, name: parent.name };
    }
    const bookingIds = profile.bookings.map((booking) => booking.id);
    const managerReviews = bookingIds.length
      ? await db
          .select()
          .from(eventManagerReviews)
          .where(inArray(eventManagerReviews.bookingId, bookingIds))
          .orderBy(desc(eventManagerReviews.createdAt))
      : [];
    const managerReviewAverage = managerReviews.length ? managerReviews.reduce((sum, review) => sum + review.rating, 0) / managerReviews.length : null;
    res.json({ ...profile, familyContext, organizationContext: manualOrganizationContext, managerReviews, managerReviewAverage, assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true" });
  } catch (err) {
    req.log.error({ err }, "Failed to get event profile");
    res.status(500).json({ error: "Failed to get event profile" });
  }
});

router.patch("/event-profiles/:id", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!uuid.safeParse(id).success) {
    res.status(400).json({ ok: false, error: "Invalid profile ID." });
    return;
  }
  const parsed = editProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the profile details." });
    return;
  }
  try {
    const [updated] = await db
      .update(organizations)
      .set({ ...parsed.data, normalizedPhone: normalizedPhone(parsed.data.phone), updatedAt: new Date() })
      .where(eq(organizations.id, id))
      .returning({ id: organizations.id });
    if (!updated) {
      res.status(404).json({ ok: false, error: "Profile not found." });
      return;
    }
    res.json({ ok: true, profileId: updated.id });
  } catch (error) {
    req.log.error({ err: error }, "Failed to update event profile");
    res.status(500).json({ ok: false, error: "The profile could not be saved. Try again." });
  }
});

router.get("/event-profiles/:id/seed", async (req, res): Promise<void> => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!uuid.safeParse(id).success) { res.json(null); return; }
  try {
    const repo = new DrizzleEventProfileRepository(db);
    const profile = await repo.getEventProfile(id);
    if (!profile) { res.json(null); return; }
    res.json({
      city: profile.place.city ?? "",
      region: profile.place.region ?? "",
      contacts: profile.contacts.map((c) => ({ id: c.id, name: c.name, phone: c.phone ?? "", email: c.email ?? "", role: c.role ?? "", isPrimary: c.isPrimary })),
      bookings: profile.bookings.map((b) => ({ id: b.id, name: b.name })),
      followUps: profile.followUps.map((f) => ({ id: f.id, kind: f.kind })),
      groups: profile.groups.map((g) => ({ id: g.id, name: g.name })),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get event profile seed");
    res.status(500).json(null);
  }
});

router.post("/event-profiles", async (req, res): Promise<void> => {
  const parsed = creationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.issues[0]?.message ?? "Review the event profile details." });
    return;
  }
  const now = new Date();
  try {
    await db.execute(sql.raw("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text"));
    const profileId = await db.transaction(async (transaction) => {
      let organizationId = parsed.data.event.id;
      let eventCity = parsed.data.event.city.trim();
      let eventRegion = parsed.data.event.region.trim().toUpperCase();
      if (organizationId && parsed.data.parentOrganizationId) throw new Error("ORGANIZATION_CREATE_REQUIRES_NEW_PROFILE");
      if (organizationId) {
        const [found] = await transaction.select({ id: organizations.id, city: organizations.city, region: organizations.region, consolidatedIntoId: organizations.consolidatedIntoId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
        if (!found) throw new Error("EVENT_NOT_FOUND");
        eventCity = found.city?.trim() ?? "";
        eventRegion = found.region?.trim().toUpperCase() ?? "";
      } else {
        if (parsed.data.parentOrganizationId) {
          const [parent] = await transaction.select({ id: organizations.id, consolidatedIntoId: organizations.consolidatedIntoId, parentOrganizationId: organizations.parentOrganizationId }).from(organizations).where(eq(organizations.id, parsed.data.parentOrganizationId)).limit(1);
          if (!parent) throw new Error("PARENT_ORGANIZATION_NOT_FOUND");
          if (parent.consolidatedIntoId || parent.parentOrganizationId) throw new Error("PARENT_ORGANIZATION_INVALID");
        }
        const profile = parsed.data.profile;
        const [created] = await transaction.insert(organizations).values({
          name: parsed.data.event.name.trim(),
          city: eventCity || null,
          region: eventRegion || null,
          placeType: profile.placeType,
          phone: profile.phone.trim() || null,
          normalizedPhone: normalizedPhone(profile.phone.trim() || null),
          website: profile.website.trim() || null,
          address1: profile.address1.trim() || null,
          address2: profile.address2.trim() || null,
          postalCode: profile.postalCode.trim() || null,
          parentOrganizationId: parsed.data.parentOrganizationId,
          createdAt: now,
          updatedAt: now,
        }).returning({ id: organizations.id });
        if (!created) throw new Error("EVENT_CREATE_FAILED");
        organizationId = created.id;
        await transaction.execute(sql`update organizations set description = ${profile.description.trim() || null} where id = ${organizationId}::uuid`);
      }

      if (parsed.data.familyId) {
        const [family] = await transaction.select({ id: eventFamilies.id }).from(eventFamilies).where(eq(eventFamilies.id, parsed.data.familyId)).limit(1);
        if (!family) throw new Error("EVENT_FAMILY_NOT_FOUND");
        const [organizationState] = await transaction.select({ consolidatedIntoId: organizations.consolidatedIntoId }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
        if (organizationState?.consolidatedIntoId) throw new Error("GROUPED_PROFILE_CONFLICT");
        const [existingMembership] = await transaction.select({ familyId: eventFamilyMembers.familyId }).from(eventFamilyMembers).where(eq(eventFamilyMembers.organizationId, organizationId)).limit(1);
        if (existingMembership && existingMembership.familyId !== parsed.data.familyId) throw new Error("EVENT_FAMILY_CONFLICT");
        if (!existingMembership) await transaction.insert(eventFamilyMembers).values({ familyId: parsed.data.familyId, organizationId, source: "manual" });
      }

      const contactIds: string[] = [];
      for (const contact of parsed.data.contacts) {
        let contactId = contact.id;
        if (contactId) {
          const [found] = await transaction.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
          if (!found) throw new Error("CONTACT_NOT_FOUND");
          const name = splitName(contact.name);
          await transaction.update(contacts).set({ firstName: name.firstName, lastName: name.lastName, phone: contact.phone.trim() || null, email: contact.email.trim().toLowerCase() || null, updatedAt: now }).where(eq(contacts.id, contactId));
        } else {
          const name = splitName(contact.name);
          const [created] = await transaction.insert(contacts).values({ firstName: name.firstName, lastName: name.lastName, phone: contact.phone.trim() || null, email: contact.email.trim().toLowerCase() || null, organizationId: null, createdAt: now, updatedAt: now }).returning({ id: contacts.id });
          if (!created) throw new Error("CONTACT_CREATE_FAILED");
          contactId = created.id;
          await transaction.insert(actContactSyncStates).values({ contactId, localDirty: true, state: "waiting", createdAt: now, updatedAt: now });
        }
        contactIds.push(contactId);
        await ensurePlacePersonRelationship(transaction, { organizationId, contactId, source: "local", now });
        const [existingRelationship] = await transaction.select({ id: organizationContacts.id }).from(organizationContacts).where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.contactId, contactId))).limit(1);
        if (existingRelationship && contact.role.trim()) await transaction.update(organizationContacts).set({ role: contact.role.trim(), updatedAt: now }).where(eq(organizationContacts.id, existingRelationship.id));
      }
      const primaryIndex = parsed.data.contacts.findIndex((contact) => contact.primary);
      const primaryContactId = contactIds[primaryIndex >= 0 ? primaryIndex : 0];
      if (primaryContactId) {
        await transaction.update(organizationContacts).set({ isPrimary: false, updatedAt: now }).where(eq(organizationContacts.organizationId, organizationId));
        await transaction.update(organizationContacts).set({ isPrimary: true, updatedAt: now }).where(and(eq(organizationContacts.organizationId, organizationId), eq(organizationContacts.contactId, primaryContactId)));
      }

      if (parsed.data.booking.enabled) {
        if (!eventCity || eventRegion.length !== 2) throw new Error("BOOKING_EVENT_LOCATION_MISSING");
        const startsAt = parsed.data.booking.startsAt ? parseBusinessDateInput(parsed.data.booking.startsAt) : null;
        const endsAt = parsed.data.booking.endsAt ? parseBusinessDateInput(parsed.data.booking.endsAt) : null;
        const [booking] = await transaction.insert(bookings).values({
          organizationId,
          name: parsed.data.booking.name.trim(),
          city: eventCity,
          region: eventRegion,
          startsAt,
          endsAt,
          travelLegId: parsed.data.booking.travelLegId,
          status: parsed.data.booking.status,
          probability: "possible",
          createdAt: now,
          updatedAt: now,
        }).returning({ id: bookings.id });
        if (!booking) throw new Error("BOOKING_CREATE_FAILED");
        if (contactIds.length) await transaction.insert(bookingContacts).values(contactIds.map((contactId) => ({ bookingId: booking.id, contactId, isPrimary: contactId === primaryContactId, source: "local" as const, createdAt: now, updatedAt: now })));
        await transaction.update(bookings).set({ primaryContactId: primaryContactId ?? null, updatedAt: now }).where(eq(bookings.id, booking.id));
        const dueAt = parseBusinessDateInput(parsed.data.booking.nextActionDueAt);
        if (!dueAt) throw new Error("INVALID_BOOKING_DATE");
        await transaction.insert(followUps).values({ bookingId: booking.id, organizationId, contactId: primaryContactId ?? null, kind: parsed.data.booking.nextActionKind.trim() || "call", dueAt, createdAt: now, updatedAt: now });
      }
      return organizationId;
    });
    res.status(201).json({ ok: true, profileId });
  } catch (error) {
    req.log.error({ err: error }, "Failed to create event profile");
    if (error instanceof Error && ["PARENT_ORGANIZATION_NOT_FOUND", "PARENT_ORGANIZATION_INVALID", "ORGANIZATION_CREATE_REQUIRES_NEW_PROFILE"].includes(error.message)) {
      res.status(error.message === "PARENT_ORGANIZATION_NOT_FOUND" ? 400 : 409).json({ ok: false, error: "That organization can no longer accept this event. Refresh and try again." });
      return;
    }
    if (error instanceof Error && ["EVENT_NOT_FOUND", "CONTACT_NOT_FOUND", "EVENT_FAMILY_NOT_FOUND"].includes(error.message)) {
      res.status(400).json({ ok: false, error: "That event or contact no longer exists. Refresh and try again." });
      return;
    }
    if (error instanceof Error && ["EVENT_FAMILY_CONFLICT", "GROUPED_PROFILE_CONFLICT"].includes(error.message)) {
      res.status(409).json({ ok: false, error: "This profile already belongs to another family or profile group. Remove it there before moving it." });
      return;
    }
    if (error instanceof Error && error.message === "BOOKING_EVENT_LOCATION_MISSING") {
      res.status(400).json({ ok: false, error: "Add a city and two-letter state to this event before creating a booking." });
      return;
    }
    res.status(500).json({ ok: false, error: "The event profile could not be saved. Try again." });
  }
});

export default router;