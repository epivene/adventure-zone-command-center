"use client";

import { useState, type FormEvent } from "react";
import { useLocation } from "wouter";

export type EventProfileCreationInput = {
  event: { id: string | null; name: string; city: string; region: string };
  contacts: { id: string | null; name: string; phone: string; email: string; role: string; primary?: boolean }[];
  booking: { enabled: boolean; name: string; nextActionKind: string; nextActionDueAt: string; travelLegId: string | null };
  familyId: string | null;
  parentOrganizationId: string | null;
};

type EventOption = { id: string; name: string; city: string | null; region: string | null };
type ContactOption = { id: string; name: string; organizationName: string | null };
type FamilyOption = { id: string; name: string };
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
  families?: FamilyOption[];
  initialFamilyId?: string;
  initialOrganizationId?: string;
  initialOrganizationName?: string;
  eventProfiles?: Record<string, EventProfileSeed>;
  loadEventProfile?: (id: string) => Promise<EventProfileSeed | null>;
  travelLegs?: { id: string; name: string; color: string }[];
  initialContactId?: string;
  initialPhone?: string;
  initialEventName?: string;
  initialCity?: string;
  initialRegion?: string;
  initialWebsite?: string;
  initialStartsAt?: string;
  initialEndsAt?: string;
  sourceScoutIntake?: boolean;
  onSubmit: (input: EventProfileCreationInput) => Promise<{ ok: true; profileId: string } | { ok: false; error: string }>;
};

const blankContact = (id = "", name = "", phone = ""): ContactDraft => ({
  id, name, phone, email: "", role: "", primary: true,
});

function contactHasContent(contact: ContactDraft) {
  return Boolean(contact.id || contact.name.trim() || contact.phone.trim() || contact.email.trim() || contact.role.trim());
}

export function EventProfileForm({
  events,
  contacts,
  families = [],
  initialFamilyId = "",
  initialOrganizationId = "",
  initialOrganizationName = "",
  eventProfiles = {},
  loadEventProfile,
  travelLegs = [],
  initialContactId = "",
  initialPhone = "",
  initialEventName = "",
  initialCity = "",
  initialRegion = "",
  initialWebsite = "",
  initialStartsAt = "",
  initialEndsAt = "",
  sourceScoutIntake = false,
  onSubmit,
}: Props) {
  const [, navigate] = useLocation();
  const [eventId, setEventId] = useState("");
  const [eventName, setEventName] = useState(initialEventName);
  const [familyId, setFamilyId] = useState(initialFamilyId);
  const [loadedProfiles, setLoadedProfiles] = useState<Record<string, EventProfileSeed>>({});
  const [contactDrafts, setContactDrafts] = useState<ContactDraft[]>([blankContact(initialContactId, "", initialPhone)]);
  const [includeBooking, setIncludeBooking] = useState(sourceScoutIntake);
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
    const selected = events.find((event) => event.id === id);
    if (selected) setEventName(selected.name);
    if (!id) return;
    const profile = eventProfiles[id] ?? await loadEventProfile?.(id);
    if (profile) {
      setLoadedProfiles((profiles) => ({ ...profiles, [id]: profile }));
      if (profile.contacts.length) {
        setContactDrafts(profile.contacts.map((contact) => ({ ...contact, primary: contact.isPrimary })));
      }
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
    setError("");
    setIsSubmitting(true);
    try {
      const populatedContacts = contactDrafts.filter(contactHasContent);
      const result = await onSubmit({
        event: {
          id: eventId || null,
          name: eventName,
          city: selectedProfile?.city ?? String(data.get("city") ?? ""),
          region: selectedProfile?.region ?? String(data.get("region") ?? ""),
        },
        contacts: populatedContacts.map(({ id, name, phone, email, role, primary }) => ({
          id: id || null,
          name,
          phone,
          email,
          role,
          primary,
        })),
        booking: {
          enabled: includeBooking,
          name: String(data.get("bookingName") ?? ""),
          nextActionKind: String(data.get("nextActionKind") ?? "call"),
          nextActionDueAt: String(data.get("nextActionDueAt") ?? ""),
          travelLegId: String(data.get("travelLegId") ?? "") || null,
        },
        familyId: familyId || null,
        parentOrganizationId: initialOrganizationId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      navigate(`/event-profiles/${result.profileId}`);
    } catch {
      setError("The event / lead could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-6" noValidate onSubmit={handleSubmit}>
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      {sourceScoutIntake ? (
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-4" aria-label="Source Scout lead handoff">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-800">Source Scout</p>
          <p className="mt-1 font-semibold text-slate-950">Review this discovered event before adding it as a lead.</p>
          <div className="mt-2 grid gap-1 text-sm text-slate-700">
            {initialStartsAt ? <p><strong>Found dates:</strong> {initialStartsAt}{initialEndsAt && initialEndsAt !== initialStartsAt ? ` – ${initialEndsAt}` : ""}</p> : null}
            {initialWebsite ? <p className="break-all"><strong>Public source:</strong> <a className="text-orange-700 underline" href={initialWebsite} target="_blank" rel="noreferrer noopener">{initialWebsite}</a></p> : null}
          </div>
          <p className="mt-2 text-xs text-slate-600">Nothing is saved until you review the form and choose the first follow-up below.</p>
        </section>
      ) : null}

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">Start here</p>
          <h2 className="mt-1 text-xl font-bold">What event or lead are you adding?</h2>
          <p className="mt-1 text-sm text-slate-600">Only the name is required. Add the rest when you know it.</p>
        </div>

        <label className="grid gap-1.5 font-medium">
          Event / lead name
          <input autoFocus name="eventName" onChange={(event) => setEventName(event.currentTarget.value)} placeholder="e.g. Dawson County Fair" required value={eventName} />
        </label>

        {initialOrganizationId ? (
          <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900">
            Part of {initialOrganizationName || "selected organization"}
          </p>
        ) : (
          <label className="grid gap-1.5 font-medium">
            Or reuse an existing profile
            <select aria-label="Use an existing profile" onChange={(event) => void selectEvent(event.currentTarget.value)} value={eventId}>
              <option value="">Create a new profile</option>
              {events.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city && item.region ? ` — ${item.city}, ${item.region}` : ""}</option>)}
            </select>
          </label>
        )}

        {!eventId ? (
          <div className="grid gap-4 sm:grid-cols-3">
            <label className="grid gap-1.5 font-medium sm:col-span-2">City <span className="text-xs font-normal text-slate-500">optional until booking</span><input defaultValue={initialCity} name="city" /></label>
            <label className="grid gap-1.5 font-medium">State <span className="text-xs font-normal text-slate-500">optional</span><input defaultValue={initialRegion} name="region" maxLength={2} /></label>
          </div>
        ) : null}

        {families.length ? (
          <label className="grid gap-1.5 font-medium">
            Event family <span className="text-xs font-normal text-slate-500">optional</span>
            <select aria-label="Event family" onChange={(event) => setFamilyId(event.currentTarget.value)} value={familyId}>
              <option value="">No event family</option>
              {families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}
            </select>
          </label>
        ) : null}

        {selectedProfile ? (
          <aside aria-label="Existing event details" className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            <p><strong>Location:</strong> {[selectedProfile.city, selectedProfile.region].filter(Boolean).join(", ") || "Not recorded"}</p>
            {selectedProfile.bookings.length ? <p><strong>Bookings:</strong> {selectedProfile.bookings.map((booking) => booking.name).join(", ")}</p> : null}
            {selectedProfile.followUps.length ? <p><strong>Follow-ups:</strong> {selectedProfile.followUps.length}</p> : null}
          </aside>
        ) : null}
      </section>

      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" open={Boolean(initialContactId || initialPhone)}>
        <summary className="cursor-pointer text-lg font-bold">Contact details <span className="text-sm font-normal text-slate-500">optional</span></summary>
        <div className="mt-4 grid gap-4">
          {contactDrafts.map((draft, index) => (
            <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2" key={`${draft.id}:${index}`}>
              <label className="grid gap-1.5 font-medium sm:col-span-2">
                Existing contact
                <select aria-label={index === 0 ? "Add an existing contact" : `Contact ${index + 1} existing contact`} onChange={(event) => selectContact(index, event.currentTarget.value)} value={draft.id}>
                  <option value="">Enter a new contact</option>
                  {availableContacts(index).map((item) => <option key={item.id} value={item.id}>{item.name}{item.organizationName ? ` — ${item.organizationName}` : ""}</option>)}
                </select>
              </label>
              <label className="grid gap-1.5 font-medium sm:col-span-2">Contact name<input aria-label={index === 0 ? "Contact name" : `Contact ${index + 1} name`} onChange={(event) => updateDraft(index, { name: event.currentTarget.value })} value={draft.name} /></label>
              <label className="grid gap-1.5 font-medium">Phone<input aria-label={index === 0 ? "Phone" : `Contact ${index + 1} phone`} onChange={(event) => updateDraft(index, { phone: event.currentTarget.value })} value={draft.phone} /></label>
              <label className="grid gap-1.5 font-medium">Email<input aria-label={index === 0 ? "Email" : `Contact ${index + 1} email`} onChange={(event) => updateDraft(index, { email: event.currentTarget.value })} type="email" value={draft.email} /></label>
              <label className="grid gap-1.5 font-medium sm:col-span-2">Role<input aria-label={index === 0 ? "Role (optional)" : `Contact ${index + 1} role`} onChange={(event) => updateDraft(index, { role: event.currentTarget.value })} value={draft.role} /></label>
              <label className="flex items-center gap-2 font-medium sm:col-span-2"><input aria-label={index === 0 ? "Primary contact" : `Contact ${index + 1} primary`} checked={draft.primary} onChange={() => selectPrimary(index)} name="primaryContact" type="radio" />Primary contact</label>
              {index > 0 ? <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => drafts.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove contact</button> : null}
            </div>
          ))}
          <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => [...drafts, { ...blankContact(), primary: false }])} type="button">Add another contact</button>
        </div>
      </details>

      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" open={sourceScoutIntake}>
        <summary className="cursor-pointer text-lg font-bold">Booking & follow-up <span className="text-sm font-normal text-slate-500">optional</span></summary>
        <div className="mt-4 grid gap-4">
          <label className="flex items-center gap-2 font-medium"><input checked={includeBooking} onChange={(event) => setIncludeBooking(event.currentTarget.checked)} type="checkbox" />Create a booking opportunity now</label>
          {includeBooking ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 font-medium sm:col-span-2">Booking name<input defaultValue={initialEventName} name="bookingName" required /></label>
              <label className="grid gap-1.5 font-medium">Travel leg<select defaultValue="" name="travelLegId"><option value="">Unassigned</option>{travelLegs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label>
              <label className="grid gap-1.5 font-medium">Next action<select defaultValue="call" name="nextActionKind"><option value="call">Call</option><option value="email">Email</option><option value="prepare_quote">Prepare quote</option></select></label>
              <label className="grid gap-1.5 font-medium">Next follow-up date<input name="nextActionDueAt" required type="date" /></label>
            </div>
          ) : null}
        </div>
      </details>

      <div className="flex justify-end">
        <button className="button-primary" disabled={isSubmitting || (!eventId && !eventName.trim())} type="submit">
          {isSubmitting ? "Saving…" : "Add Event / Lead"}
        </button>
      </div>
    </form>
  );
}
