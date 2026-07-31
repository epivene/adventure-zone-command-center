import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { EventProfileForm, type EventProfileCreationInput } from "@/components/event-profiles/event-profile-form";
import { actContactSyncStates, bookingContacts, bookings, contacts, followUps, organizationContacts, organizations } from "@/db/schema";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { DrizzleOrganizationRepository } from "@/features/organizations/organization-repository";
import { ensurePlacePersonRelationship } from "@/features/relationships/relationship-writer";
import { requireOwner } from "@/lib/auth/require-owner";
import { parseBusinessDateInput } from "@/lib/business-date";

export const dynamic = "force-dynamic";

const uuid = z.uuid();
export const creationSchema = z.object({
  event: z.object({ id: z.string().nullable(), name: z.string(), city: z.string(), region: z.string() }),
  contacts: z.array(z.object({ id: z.string().nullable(), name: z.string(), phone: z.string(), email: z.string(), role: z.string() })).min(1),
  booking: z.object({ enabled: z.boolean(), name: z.string(), nextActionKind: z.string(), nextActionDueAt: z.string() }),
}).superRefine((input, context) => {
  const selectedIds = input.contacts.map((contact) => contact.id).filter((id): id is string => Boolean(id));
  if (new Set(selectedIds).size !== selectedIds.length) context.addIssue({ code: "custom", message: "Choose each existing contact only once." });
  if (input.event.id ? !uuid.safeParse(input.event.id).success : !input.event.name.trim() || !input.event.city.trim() || input.event.region.trim().length !== 2) context.addIssue({ code: "custom", message: "Choose an event or enter its name, city, and two-letter state." });
  for (const contact of input.contacts) {
    if (contact.id ? !uuid.safeParse(contact.id).success : !contact.name.trim()) context.addIssue({ code: "custom", message: "Choose a contact or enter a contact name." });
    if (contact.email.trim() && !z.email().safeParse(contact.email.trim()).success) context.addIssue({ code: "custom", message: "Enter a valid contact email address." });
  }
  if (input.booking.enabled && (!input.booking.name.trim() || !parseBusinessDateInput(input.booking.nextActionDueAt))) context.addIssue({ code: "custom", message: "Enter a booking name and next follow-up date." });
});

function splitName(name: string) {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName: firstName ?? "", lastName: rest.join(" ") };
}

export async function createEventProfileAction(input: EventProfileCreationInput): Promise<{ ok: true; profileId: string } | { ok: false; error: string }> {
  "use server";
  await requireOwner();
  const parsed = creationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Review the event profile details." };
  const now = new Date();
  const { db } = await import("@/db/client");
  try {
    const profileId = await db.transaction(async (transaction) => {
      let organizationId = parsed.data.event.id;
      let eventCity = parsed.data.event.city.trim();
      let eventRegion = parsed.data.event.region.trim().toUpperCase();
      if (organizationId) {
        const [found] = await transaction.select({ id: organizations.id, city: organizations.city, region: organizations.region }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
        if (!found) throw new Error("EVENT_NOT_FOUND");
        eventCity = found.city?.trim() ?? "";
        eventRegion = found.region?.trim().toUpperCase() ?? "";
      } else {
        const [created] = await transaction.insert(organizations).values({ name: parsed.data.event.name.trim(), city: eventCity, region: eventRegion, placeType: "other", createdAt: now, updatedAt: now }).returning({ id: organizations.id });
        if (!created) throw new Error("EVENT_CREATE_FAILED");
        organizationId = created.id;
      }

      const contactIds: string[] = [];
      for (const contact of parsed.data.contacts) {
        let contactId = contact.id;
        if (contactId) {
          const [found] = await transaction.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, contactId)).limit(1);
          if (!found) throw new Error("CONTACT_NOT_FOUND");
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

      if (parsed.data.booking.enabled) {
        if (!eventCity || eventRegion.length !== 2) throw new Error("BOOKING_EVENT_LOCATION_MISSING");
        const [booking] = await transaction.insert(bookings).values({ organizationId, name: parsed.data.booking.name.trim(), city: eventCity, region: eventRegion, status: "new_lead", probability: "possible", createdAt: now, updatedAt: now }).returning({ id: bookings.id });
        if (!booking) throw new Error("BOOKING_CREATE_FAILED");
        await transaction.insert(bookingContacts).values(contactIds.map((contactId, index) => ({ bookingId: booking.id, contactId, isPrimary: index === 0, source: "local" as const, createdAt: now, updatedAt: now })));
        await transaction.update(bookings).set({ primaryContactId: contactIds[0], updatedAt: now }).where(eq(bookings.id, booking.id));
        const dueAt = parseBusinessDateInput(parsed.data.booking.nextActionDueAt);
        if (!dueAt) throw new Error("INVALID_BOOKING_DATE");
        await transaction.insert(followUps).values({ bookingId: booking.id, organizationId, contactId: contactIds[0], kind: parsed.data.booking.nextActionKind.trim() || "call", dueAt, createdAt: now, updatedAt: now });
      }
      return organizationId;
    });
    for (const path of ["/today", "/bookings", "/contacts", "/organizations", `/event-profiles/${profileId}`]) revalidatePath(path);
    return { ok: true, profileId };
  } catch (error) {
    if (error instanceof Error && ["EVENT_NOT_FOUND", "CONTACT_NOT_FOUND"].includes(error.message)) return { ok: false, error: "That event or contact no longer exists. Refresh and try again." };
    if (error instanceof Error && error.message === "BOOKING_EVENT_LOCATION_MISSING") return { ok: false, error: "Add a city and two-letter state to this event before creating a booking." };
    return { ok: false, error: "The event profile could not be saved. Try again." };
  }
}

function firstValue(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function NewEventProfilePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireOwner();
  const { db } = await import("@/db/client");
  const [events, contactPage, query] = await Promise.all([
    new DrizzleOrganizationRepository(db).listOrganizations({ search: "", lastResort: "all", travelLegId: null, page: 1, pageSize: 100 }),
    new DrizzleContactRepository(db).listContacts({ search: "", state: "all", page: 1, pageSize: 100 }),
    searchParams,
  ]);
  const contactId = firstValue(query.contactId);
  const phoneMatch = await new DrizzleContactRepository(db).findContactsByPhone(firstValue(query.phone) ?? "");
  const requestedContact = contactId && !contactPage.records.some((contact) => contact.id === contactId)
    ? await new DrizzleContactRepository(db).getContactDetail(contactId)
    : null;
  const phoneContact = phoneMatch.kind === "one" ? phoneMatch.contact : null;
  const contactOptions = [...contactPage.records.map((contact) => ({ id: contact.id, name: `${contact.firstName} ${contact.lastName}`.trim(), organizationName: contact.organizationName })), ...(requestedContact ? [{ id: requestedContact.contact.id, name: `${requestedContact.contact.firstName} ${requestedContact.contact.lastName}`.trim(), organizationName: requestedContact.contact.organizationName }] : []), ...(phoneContact ? [{ id: phoneContact.id, name: `${phoneContact.firstName} ${phoneContact.lastName}`.trim(), organizationName: phoneContact.organizationName }] : [])].filter((contact, index, all) => all.findIndex((candidate) => candidate.id === contact.id) === index);
  const initialSelectedContactId = requestedContact?.contact.id ?? phoneContact?.id ?? contactId ?? "";
  return <div className="mx-auto grid max-w-3xl gap-6"><header><p className="text-sm font-bold uppercase tracking-[0.16em] text-orange-700">New event profile</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Create an event profile</h1><p className="mt-2 text-slate-600">Start with the event, add people to contact, then create a booking when it is ready.</p></header><section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7"><EventProfileForm contacts={contactOptions} events={events.records.map((event) => ({ id: event.id, name: event.name, city: null, region: null }))} initialContactId={initialSelectedContactId} initialPhone={firstValue(query.phone) ?? ""} onSubmit={createEventProfileAction} /></section></div>;
}
