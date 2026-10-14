"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DuplicateCreationWarning } from "@/components/profiles/duplicate-creation-warning";
import { useLocation } from "wouter";
import { browserProfileDraftStore, type ProfileDraft, type ProfileDraftContact } from "@/lib/profile-draft";

export type EventProfileCreationInput = {
  event: { id: null; name: string; city: string; region: string };
  profile: {
    placeType: "fair" | "city_government" | "festival_event" | "venue" | "school" | "tribe" | "association" | "company" | "other";
    description: string;
    phone: string;
    website: string;
    address1: string;
    address2: string;
    postalCode: string;
  };
  contacts: { id: string | null; name: string; phone: string; email: string; role: string; primary?: boolean }[];
  booking: {
    enabled: boolean;
    name: string;
    status: ProfileDraft["bookingStatus"];
    startsAt: string;
    endsAt: string;
    nextActionKind: string;
    nextActionDueAt: string;
    travelLegId: string | null;
  };
  familyId: string | null;
  parentOrganizationId: string | null;
};

type ContactOption = { id: string; name: string; organizationName: string | null };
type FamilyOption = { id: string; name: string };
type ContactDraft = ProfileDraftContact;

type Props = {
  contacts: ContactOption[];
  families?: FamilyOption[];
  initialFamilyId?: string;
  initialOrganizationId?: string;
  initialOrganizationName?: string;
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

function dateOnly(value: string) {
  return value ? value.slice(0, 10) : "";
}

function draftHasContent(draft: Omit<ProfileDraft, "savedAt">) {
  return Boolean(
    draft.eventName.trim() || draft.description.trim() || draft.phone.trim() || draft.website.trim() ||
    draft.address1.trim() || draft.address2.trim() || draft.city.trim() || draft.region.trim() || draft.postalCode.trim() ||
    draft.familyId || draft.contacts.some(contactHasContent) || draft.includeBooking,
  );
}

export function EventProfileForm({
  contacts,
  families = [],
  initialFamilyId = "",
  initialOrganizationId = "",
  initialOrganizationName = "",
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
  const draftStore = useMemo(() => browserProfileDraftStore(), []);
  const canRestoreDraft = !sourceScoutIntake && !initialOrganizationId && !initialEventName && !initialCity && !initialRegion && !initialWebsite && !initialContactId && !initialPhone;
  const restoredDraft = useMemo(() => canRestoreDraft ? draftStore?.load() ?? null : null, [canRestoreDraft, draftStore]);

  const [eventName, setEventName] = useState(restoredDraft?.eventName ?? initialEventName);
  const [placeType, setPlaceType] = useState<ProfileDraft["placeType"]>(restoredDraft?.placeType ?? "festival_event");
  const [description, setDescription] = useState(restoredDraft?.description ?? "");
  const [phone, setPhone] = useState(restoredDraft?.phone ?? "");
  const [website, setWebsite] = useState(restoredDraft?.website ?? initialWebsite);
  const [address1, setAddress1] = useState(restoredDraft?.address1 ?? "");
  const [address2, setAddress2] = useState(restoredDraft?.address2 ?? "");
  const [city, setCity] = useState(restoredDraft?.city ?? initialCity);
  const [region, setRegion] = useState(restoredDraft?.region ?? initialRegion);
  const [postalCode, setPostalCode] = useState(restoredDraft?.postalCode ?? "");
  const [familyId, setFamilyId] = useState(restoredDraft?.familyId ?? initialFamilyId);
  const [contactDrafts, setContactDrafts] = useState<ContactDraft[]>(restoredDraft?.contacts?.length ? restoredDraft.contacts : [blankContact(initialContactId, "", initialPhone)]);
  const [includeBooking, setIncludeBooking] = useState(restoredDraft?.includeBooking ?? sourceScoutIntake);
  const [bookingName, setBookingName] = useState(restoredDraft?.bookingName ?? initialEventName);
  const [bookingStatus, setBookingStatus] = useState<ProfileDraft["bookingStatus"]>(restoredDraft?.bookingStatus ?? "new_lead");
  const [startsAt, setStartsAt] = useState(restoredDraft?.startsAt ?? dateOnly(initialStartsAt));
  const [endsAt, setEndsAt] = useState(restoredDraft?.endsAt ?? dateOnly(initialEndsAt));
  const [travelLegId, setTravelLegId] = useState(restoredDraft?.travelLegId ?? "");
  const [nextActionKind, setNextActionKind] = useState(restoredDraft?.nextActionKind ?? "call");
  const [nextActionDueAt, setNextActionDueAt] = useState(restoredDraft?.nextActionDueAt ?? "");
  const [showRecovered, setShowRecovered] = useState(Boolean(restoredDraft));
  const [draftStatus, setDraftStatus] = useState(restoredDraft ? "Recovered draft" : "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!draftStore) return;
    const draft: Omit<ProfileDraft, "savedAt"> = {
      eventName, placeType, description, phone, website, address1, address2, city, region, postalCode, familyId,
      contacts: contactDrafts,
      includeBooking, bookingName, bookingStatus, startsAt, endsAt, travelLegId, nextActionKind, nextActionDueAt,
    };
    const timer = window.setTimeout(() => {
      if (!draftHasContent(draft)) {
        draftStore.clear();
        setDraftStatus("");
        return;
      }
      draftStore.save({ ...draft, savedAt: new Date().toISOString() });
      setDraftStatus("Draft saved");
    }, 500);
    return () => window.clearTimeout(timer);
  }, [address1, address2, bookingName, bookingStatus, city, contactDrafts, description, draftStore, endsAt, eventName, familyId, includeBooking, nextActionDueAt, nextActionKind, phone, placeType, postalCode, region, startsAt, travelLegId, website]);

  function updateContact(index: number, values: Partial<ContactDraft>) {
    setContactDrafts((drafts) => drafts.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...values } : draft));
  }

  function availableContacts(index: number) {
    return contacts.filter((contact) => contact.id === contactDrafts[index]?.id || !contactDrafts.some((draft, draftIndex) => draftIndex !== index && draft.id === contact.id));
  }

  function selectContact(index: number, id: string) {
    const selected = contacts.find((contact) => contact.id === id);
    updateContact(index, { id, name: selected?.name ?? "", phone: "", email: "", role: "" });
  }

  function selectPrimary(index: number) {
    setContactDrafts((drafts) => drafts.map((draft, draftIndex) => ({ ...draft, primary: draftIndex === index })));
  }

  function startOver() {
    draftStore?.clear();
    setEventName(initialEventName);
    setPlaceType("festival_event");
    setDescription("");
    setPhone("");
    setWebsite(initialWebsite);
    setAddress1("");
    setAddress2("");
    setCity(initialCity);
    setRegion(initialRegion);
    setPostalCode("");
    setFamilyId(initialFamilyId);
    setContactDrafts([blankContact(initialContactId, "", initialPhone)]);
    setIncludeBooking(sourceScoutIntake);
    setBookingName(initialEventName);
    setBookingStatus("new_lead");
    setStartsAt(dateOnly(initialStartsAt));
    setEndsAt(dateOnly(initialEndsAt));
    setTravelLegId("");
    setNextActionKind("call");
    setNextActionDueAt("");
    setShowRecovered(false);
    setDraftStatus("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);
    try {
      const populatedContacts = contactDrafts.filter(contactHasContent);
      const result = await onSubmit({
        event: { id: null, name: eventName, city, region },
        profile: { placeType, description, phone, website, address1, address2, postalCode },
        contacts: populatedContacts.map(({ id, name, phone: contactPhone, email, role, primary }) => ({
          id: id || null, name, phone: contactPhone, email, role, primary,
        })),
        booking: {
          enabled: includeBooking,
          name: bookingName,
          status: bookingStatus,
          startsAt,
          endsAt,
          nextActionKind,
          nextActionDueAt,
          travelLegId: travelLegId || null,
        },
        familyId: familyId || null,
        parentOrganizationId: initialOrganizationId || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      draftStore?.clear();
      navigate(`/event-profiles/${result.profileId}`);
    } catch {
      setError("The profile could not be saved. Your draft is still on this device, so you can try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-6" noValidate onSubmit={handleSubmit}>
      <DuplicateCreationWarning name={eventName} city={city} region={region} />
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      {showRecovered ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4" aria-label="Recovered profile draft">
          <div>
            <p className="font-bold text-amber-950">Recovered unfinished profile</p>
            <p className="text-sm text-amber-900">Your unsaved work from this device has been restored.</p>
          </div>
          <button className="button-secondary" onClick={startOver} type="button">Start over</button>
        </section>
      ) : null}

      {sourceScoutIntake ? (
        <section className="rounded-xl border border-orange-200 bg-orange-50 p-4" aria-label="Source Scout lead handoff">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-800">Source Scout</p>
          <p className="mt-1 font-semibold text-slate-950">Review this discovered event before saving its profile.</p>
          <div className="mt-2 grid gap-1 text-sm text-slate-700">
            {initialStartsAt ? <p><strong>Found dates:</strong> {initialStartsAt}{initialEndsAt && initialEndsAt !== initialStartsAt ? ` – ${initialEndsAt}` : ""}</p> : null}
            {initialWebsite ? <p className="break-all"><strong>Public source:</strong> <a className="text-orange-700 underline" href={initialWebsite} target="_blank" rel="noreferrer noopener">{initialWebsite}</a></p> : null}
          </div>
          <p className="mt-2 text-xs text-slate-600">Nothing is added to the database until you press Save Profile.</p>
        </section>
      ) : null}

      <section className="grid gap-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-orange-700">Profile</p>
          <h2 className="mt-1 text-xl font-bold">Event profile details</h2>
          <p className="mt-1 text-sm text-slate-600">The name is the only required field. Fill in everything you already know.</p>
        </div>

        <label className="grid gap-1.5 font-medium">Profile / event name<input autoFocus aria-label="Profile / event name" onChange={(event) => setEventName(event.currentTarget.value)} placeholder="e.g. Dawson County Fair" required value={eventName} /></label>

        {initialOrganizationId ? <p className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm font-semibold text-orange-900">Part of {initialOrganizationName || "selected organization"}</p> : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 font-medium">Profile type<select aria-label="Profile type" onChange={(event) => setPlaceType(event.currentTarget.value as ProfileDraft["placeType"])} value={placeType}><option value="festival_event">Festival / event</option><option value="fair">Fair</option><option value="venue">Venue</option><option value="school">School</option><option value="city_government">City / government</option><option value="tribe">Tribe</option><option value="association">Association</option><option value="company">Company</option><option value="other">Other</option></select></label>
          <label className="grid gap-1.5 font-medium">Office phone<input aria-label="Office phone" onChange={(event) => setPhone(event.currentTarget.value)} type="tel" value={phone} /></label>
          <label className="grid gap-1.5 font-medium sm:col-span-2">Website<input aria-label="Website" onChange={(event) => setWebsite(event.currentTarget.value)} type="url" value={website} /></label>
          <label className="grid gap-1.5 font-medium sm:col-span-2">Description<textarea aria-label="Description" className="min-h-28" onChange={(event) => setDescription(event.currentTarget.value)} placeholder="What the event is, who it serves, useful context, recurring details, etc." value={description} /></label>
        </div>
      </section>

      <section className="grid gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div><h2 className="text-lg font-bold">Venue / location</h2><p className="mt-1 text-sm text-slate-600">Where the event actually takes place.</p></div>
        <label className="grid gap-1.5 font-medium">Venue address<input aria-label="Venue address" onChange={(event) => setAddress1(event.currentTarget.value)} value={address1} /></label>
        <label className="grid gap-1.5 font-medium">Address line 2 <span className="text-xs font-normal text-slate-500">optional</span><input aria-label="Address line 2" onChange={(event) => setAddress2(event.currentTarget.value)} value={address2} /></label>
        <div className="grid gap-4 sm:grid-cols-4">
          <label className="grid gap-1.5 font-medium sm:col-span-2">City<input aria-label="City" onChange={(event) => setCity(event.currentTarget.value)} value={city} /></label>
          <label className="grid gap-1.5 font-medium">State<input aria-label="State" maxLength={2} onChange={(event) => setRegion(event.currentTarget.value.toUpperCase())} value={region} /></label>
          <label className="grid gap-1.5 font-medium">ZIP code<input aria-label="ZIP code" onChange={(event) => setPostalCode(event.currentTarget.value)} value={postalCode} /></label>
        </div>
        {families.length ? <label className="grid gap-1.5 font-medium">Event family <span className="text-xs font-normal text-slate-500">optional</span><select aria-label="Event family" onChange={(event) => setFamilyId(event.currentTarget.value)} value={familyId}><option value="">No event family</option>{families.map((family) => <option key={family.id} value={family.id}>{family.name}</option>)}</select></label> : null}
      </section>

      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" open={Boolean(initialContactId || initialPhone || contactDrafts.some(contactHasContent))}>
        <summary className="cursor-pointer text-lg font-bold">Contacts <span className="text-sm font-normal text-slate-500">optional</span></summary>
        <div className="mt-4 grid gap-4">
          {contactDrafts.map((draft, index) => (
            <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2" key={`${draft.id}:${index}`}>
              <label className="grid gap-1.5 font-medium sm:col-span-2">Existing contact<select aria-label={index === 0 ? "Add an existing contact" : `Contact ${index + 1} existing contact`} onChange={(event) => selectContact(index, event.currentTarget.value)} value={draft.id}><option value="">Enter a new contact</option>{availableContacts(index).map((item) => <option key={item.id} value={item.id}>{item.name}{item.organizationName ? ` — ${item.organizationName}` : ""}</option>)}</select></label>
              <label className="grid gap-1.5 font-medium sm:col-span-2">Contact name<input aria-label={index === 0 ? "Contact name" : `Contact ${index + 1} name`} onChange={(event) => updateContact(index, { name: event.currentTarget.value })} value={draft.name} /></label>
              <label className="grid gap-1.5 font-medium">Phone<input aria-label={index === 0 ? "Phone" : `Contact ${index + 1} phone`} onChange={(event) => updateContact(index, { phone: event.currentTarget.value })} value={draft.phone} /></label>
              <label className="grid gap-1.5 font-medium">Email<input aria-label={index === 0 ? "Email" : `Contact ${index + 1} email`} onChange={(event) => updateContact(index, { email: event.currentTarget.value })} type="email" value={draft.email} /></label>
              <label className="grid gap-1.5 font-medium sm:col-span-2">Role<input aria-label={index === 0 ? "Role (optional)" : `Contact ${index + 1} role`} onChange={(event) => updateContact(index, { role: event.currentTarget.value })} value={draft.role} /></label>
              <label className="flex items-center gap-2 font-medium sm:col-span-2"><input aria-label={index === 0 ? "Primary contact" : `Contact ${index + 1} primary`} checked={draft.primary} onChange={() => selectPrimary(index)} name="primaryContact" type="radio" />Primary contact</label>
              {index > 0 ? <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => drafts.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove contact</button> : null}
            </div>
          ))}
          <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => [...drafts, { ...blankContact(), primary: false }])} type="button">Add another contact</button>
        </div>
      </details>

      <details className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" open={sourceScoutIntake || includeBooking}>
        <summary className="cursor-pointer text-lg font-bold">Booking & follow-up <span className="text-sm font-normal text-slate-500">optional</span></summary>
        <div className="mt-4 grid gap-4">
          <label className="flex items-center gap-2 font-medium"><input aria-label="Create a booking opportunity now" checked={includeBooking} onChange={(event) => setIncludeBooking(event.currentTarget.checked)} type="checkbox" />Create a booking opportunity now</label>
          {includeBooking ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 font-medium sm:col-span-2">Booking name<input aria-label="Booking name" onChange={(event) => setBookingName(event.currentTarget.value)} required value={bookingName} /></label>
              <label className="grid gap-1.5 font-medium">Booking stage<select aria-label="Booking stage" onChange={(event) => setBookingStatus(event.currentTarget.value as ProfileDraft["bookingStatus"])} value={bookingStatus}><option value="new_lead">New lead</option><option value="researching">Researching</option><option value="contact_due">Contact due</option><option value="contacted">Contacted</option><option value="interested">Interested</option><option value="possible">Possible</option><option value="unlikely">Unlikely</option><option value="quote_sent">Quote sent</option><option value="pending_decision">Pending decision</option><option value="pending_contract">Pending contract</option><option value="contract_received">Contract received</option><option value="confirmed">Confirmed</option><option value="declined">Declined</option><option value="cancelled">Cancelled</option><option value="completed">Completed</option><option value="renewal_due">Renewal due</option></select></label>
              <label className="grid gap-1.5 font-medium">Travel leg<select aria-label="Travel leg" onChange={(event) => setTravelLegId(event.currentTarget.value)} value={travelLegId}><option value="">Unassigned</option>{travelLegs.map((leg) => <option key={leg.id} value={leg.id}>{leg.name}</option>)}</select></label>
              <label className="grid gap-1.5 font-medium">Event start date<input aria-label="Event start date" onChange={(event) => setStartsAt(event.currentTarget.value)} type="date" value={startsAt} /></label>
              <label className="grid gap-1.5 font-medium">Event end date<input aria-label="Event end date" min={startsAt || undefined} onChange={(event) => setEndsAt(event.currentTarget.value)} type="date" value={endsAt} /></label>
              <label className="grid gap-1.5 font-medium">Next action<select aria-label="Next action" onChange={(event) => setNextActionKind(event.currentTarget.value)} value={nextActionKind}><option value="call">Call</option><option value="email">Email</option><option value="prepare_quote">Prepare quote</option></select></label>
              <label className="grid gap-1.5 font-medium">Next follow-up date<input aria-label="Next follow-up date" onChange={(event) => setNextActionDueAt(event.currentTarget.value)} required type="date" value={nextActionDueAt} /></label>
            </div>
          ) : null}
        </div>
      </details>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm text-slate-600"><strong>No profile exists until you save.</strong>{draftStatus ? <span className="ml-2 text-emerald-700">{draftStatus}</span> : null}</div>
        <button className="button-primary" disabled={isSubmitting || !eventName.trim()} type="submit">{isSubmitting ? "Saving…" : "Save Profile"}</button>
      </div>
    </form>
  );
}
