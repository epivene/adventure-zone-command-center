"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type EventProfileCreationInput = {
  event: { id: string | null; name: string; city: string; region: string };
  contacts: { id: string | null; name: string; phone: string; email: string; role: string; primary?: boolean }[];
  booking: { enabled: boolean; name: string; nextActionKind: string; nextActionDueAt: string; travelLegId: string | null };
};

type EventOption = { id: string; name: string; city: string | null; region: string | null };
type ContactOption = { id: string; name: string; organizationName: string | null };
type ContactDraft = { id: string; name: string; phone: string; email: string; role: string; primary: boolean };
export type EventProfileSeed = {
  city: string;
  region: string;
  contacts: (Omit<ContactDraft, "primary"> & { isPrimary: boolean })[];
  bookings: { id: string; name: string }[];
  followUps: { id: string; kind: string }[];
  groups: { id: string; name: string }[];
};

type Props = {
  events: EventOption[];
  contacts: ContactOption[];
  eventProfiles?: Record<string, EventProfileSeed>;
  loadEventProfile?: (id: string) => Promise<EventProfileSeed | null>;
  travelLegs?: { id: string; name: string; color: string }[];
  initialContactId?: string;
  initialPhone?: string;
  onSubmit: (input: EventProfileCreationInput) => Promise<{ ok: true; profileId: string } | { ok: false; error: string }>;
};

const blankContact = (id = "", name = "", phone = ""): ContactDraft => ({
  id, name, phone, email: "", role: "", primary: true,
});

export function EventProfileForm({
  events, contacts, eventProfiles = {}, loadEventProfile, travelLegs = [], initialContactId = "", initialPhone = "", onSubmit,
}: Props) {
  const router = useRouter();
  const [eventId, setEventId] = useState("");
  const [loadedProfiles, setLoadedProfiles] = useState<Record<string, EventProfileSeed>>({});
  const [contactDrafts, setContactDrafts] = useState<ContactDraft[]>([blankContact(initialContactId, "", initialPhone)]);
  const [includeBooking, setIncludeBooking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const selectedProfile = eventProfiles[eventId] ?? loadedProfiles[eventId];

  function updateDraft(index: number, values: Partial<ContactDraft>) {
    setContactDrafts((drafts) => drafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...values } : draft));
  }
  function availableContacts(index: number) {
    return contacts.filter((contact) => contact.id === contactDrafts[index]?.id || !contactDrafts.some((draft, draftIndex) => draftIndex !== index && draft.id === contact.id));
  }
  async function selectEvent(id: string) {
    setEventId(id);
    const profile = eventProfiles[id] ?? await loadEventProfile?.(id);
    if (profile) {
      setLoadedProfiles((profiles) => ({ ...profiles, [id]: profile }));
      setContactDrafts(profile.contacts.length ? profile.contacts.map((contact) => ({ ...contact, primary: contact.isPrimary })) : [blankContact()]);
    }
  }
  function selectContact(index: number, id: string) {
    const selected = contacts.find((contact) => contact.id === id);
    updateDraft(index, { id, name: selected?.name ?? "", phone: "", email: "", role: "" });
  }
  function selectPrimary(index: number) {
    setContactDrafts((drafts) => drafts.map((draft, draftIndex) => ({ ...draft, primary: draftIndex === index })));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError(""); setIsSubmitting(true);
    try {
      const result = await onSubmit({
        event: { id: eventId || null, name: String(data.get("eventName") ?? ""), city: selectedProfile?.city ?? String(data.get("city") ?? ""), region: selectedProfile?.region ?? String(data.get("region") ?? "") },
        contacts: contactDrafts.map(({ id, name, phone, email, role, primary }) => ({ id: id || null, name, phone, email, role, primary })),
        booking: { enabled: includeBooking, name: String(data.get("bookingName") ?? ""), nextActionKind: String(data.get("nextActionKind") ?? "call"), nextActionDueAt: String(data.get("nextActionDueAt") ?? ""), travelLegId: String(data.get("travelLegId") ?? "") || null },
      });
      if (!result.ok) { setError(result.error); return; }
      router.push(`/event-profiles/${result.profileId}`);
    } catch { setError("The event profile could not be saved. Try again."); }
    finally { setIsSubmitting(false); }
  }

  return <form className="grid gap-8" noValidate onSubmit={handleSubmit}>
    {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}
    <fieldset className="grid gap-4"><legend className="text-xl font-bold">1. Event identity</legend>
      <label className="grid gap-1.5 font-medium">Find an existing event<select aria-label="Find an existing event" onChange={(event) => selectEvent(event.currentTarget.value)} value={eventId}><option value="">Create a new event</option>{events.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city && item.region ? ` â€” ${item.city}, ${item.region}` : ""}</option>)}</select></label>
      {!eventId ? <div className="grid gap-4 sm:grid-cols-3"><label className="grid gap-1.5 font-medium sm:col-span-3">Event name<input name="eventName" required /></label><label className="grid gap-1.5 font-medium sm:col-span-2">City<input name="city" required /></label><label className="grid gap-1.5 font-medium">State<input name="region" maxLength={2} required /></label></div> : null}
      {selectedProfile ? <aside aria-label="Existing event details" className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><p><strong>Location:</strong> {selectedProfile.city}, {selectedProfile.region}</p>{selectedProfile.bookings.length ? <p><strong>Bookings:</strong> {selectedProfile.bookings.map((booking) => booking.name).join(", ")}</p> : null}{selectedProfile.groups.length ? <p><strong>Calling lists:</strong> {selectedProfile.groups.map((group) => group.name).join(", ")}</p> : null}{selectedProfile.followUps.length ? <p><strong>Follow-ups:</strong> {selectedProfile.followUps.length}</p> : null}</aside> : null}
    </fieldset>
    <fieldset className="grid gap-4 border-t border-slate-200 pt-6"><legend className="text-xl font-bold">2. Contact</legend>
      {contactDrafts.map((draft, index) => <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2" key={`${draft.id}:${index}`}>
        <label className="grid gap-1.5 font-medium sm:col-span-2">{index === 0 ? "Add an existing contact" : `Contact ${index + 1} existing contact`}<select aria-label={index === 0 ? "Add an existing contact" : `Contact ${index + 1} existing contact`} onChange={(event) => selectContact(index, event.currentTarget.value)} value={draft.id}><option value="">Create a new contact</option>{availableContacts(index).map((item) => <option key={item.id} value={item.id}>{item.name}{item.organizationName ? ` â€” ${item.organizationName}` : ""}</option>)}</select></label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">{index === 0 ? "Contact name" : `Contact ${index + 1} name`}<input aria-label={index === 0 ? "Contact name" : `Contact ${index + 1} name`} name={`contactName-${index}`} onChange={(event) => updateDraft(index, { name: event.currentTarget.value })} required value={draft.name} /></label>
        <label className="grid gap-1.5 font-medium">Phone<input aria-label={index === 0 ? "Phone" : `Contact ${index + 1} phone`} name={`phone-${index}`} onChange={(event) => updateDraft(index, { phone: event.currentTarget.value })} value={draft.phone} /></label>
        <label className="grid gap-1.5 font-medium">Email<input aria-label={index === 0 ? "Email" : `Contact ${index + 1} email`} name={`email-${index}`} onChange={(event) => updateDraft(index, { email: event.currentTarget.value })} type="email" value={draft.email} /></label>
        <label className="grid gap-1.5 font-medium sm:col-span-2">Role (optional)<input aria-label={index === 0 ? "Role (optional)" : `Contact ${index + 1} role`} name={`role-${index}`} onChange={(event) => updateDraft(index, { role: event.currentTarget.value })} value={draft.role} /></label>
        <label className="flex items-center gap-2 font-medium sm:col-span-2"><input aria-label={index === 0 ? "Primary contact" : `Contact ${index + 1} primary`} checked={draft.primary} onChange={() => selectPrimary(index)} name="primaryContact" type="radio" />Primary contact</label>
        {index > 0 ? <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => drafts.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove contact</button> : null}
      </div>)}
      <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => [...drafts.map((draft) => ({ ...draft, primary: false })), { ...blankContact(), primary: false }])} type="button">Add another contact</button>
    </fieldset>
    <fieldset className="grid gap-4 border-t border-slate-200 pt-6"><legend className="text-xl font-bold">3. Booking (optional)</legend><label className="flex items-center gap-2 font-medium"><input checked={includeBooking} onChange={(event) => setIncludeBooking(event.currentTarget.checked)} type="checkbox" />Create a booking for this event</label>{includeBooking ? <div className="grid gap-4 sm:grid-cols-2"><label className="grid gap-1.5 font-medium sm:col-span-2">Booking name<input name="bookingName" required /></label><label className="grid gap-1.5 font-medium">Travel leg<select defaultValue="" name="travelLegId"><option value="">Unassigned</option>{travelLegs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label><label className="grid gap-1.5 font-medium">Next action<select defaultValue="call" name="nextActionKind"><option value="call">Call</option><option value="email">Email</option><option value="prepare_quote">Prepare quote</option></select></label><label className="grid gap-1.5 font-medium">Next follow-up date<input name="nextActionDueAt" required type="date" /></label></div> : null}</fieldset>
    <div className="flex justify-end"><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Creating…" : "Create event profile"}</button></div>
  </form>;
}
