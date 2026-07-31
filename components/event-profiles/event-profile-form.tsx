"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export type EventProfileCreationInput = {
  event: { id: string | null; name: string; city: string; region: string };
  contacts: { id: string | null; name: string; phone: string; email: string; role: string }[];
  booking: { enabled: boolean; name: string; nextActionKind: string; nextActionDueAt: string };
};

type EventOption = { id: string; name: string; city: string | null; region: string | null };
type ContactOption = { id: string; name: string; organizationName: string | null };

type Props = {
  events: EventOption[];
  contacts: ContactOption[];
  initialContactId?: string;
  initialPhone?: string;
  onSubmit: (input: EventProfileCreationInput) => Promise<
    { ok: true; profileId: string } | { ok: false; error: string }
  >;
};

type ContactDraft = { id: string; name: string; phone: string; email: string; role: string };

export function EventProfileForm({
  events,
  contacts,
  initialContactId = "",
  initialPhone = "",
  onSubmit,
}: Props) {
  const router = useRouter();
  const [eventId, setEventId] = useState("");
  const [contactDrafts, setContactDrafts] = useState<ContactDraft[]>([{ id: initialContactId, name: "", phone: initialPhone, email: "", role: "" }]);
  const [includeBooking, setIncludeBooking] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setError("");
    setIsSubmitting(true);
    try {
      const result = await onSubmit({
        event: {
          id: eventId || null,
          name: String(data.get("eventName") ?? ""),
          city: String(data.get("city") ?? ""),
          region: String(data.get("region") ?? ""),
        },
        contacts: contactDrafts.map((draft, index) => ({
          id: draft.id || null,
          name: String(data.get(`contactName-${index}`) ?? ""),
          phone: String(data.get(`phone-${index}`) ?? ""),
          email: String(data.get(`email-${index}`) ?? ""),
          role: String(data.get(`role-${index}`) ?? ""),
        })),
        booking: {
          enabled: includeBooking,
          name: String(data.get("bookingName") ?? ""),
          nextActionKind: String(data.get("nextActionKind") ?? "call"),
          nextActionDueAt: String(data.get("nextActionDueAt") ?? ""),
        },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/event-profiles/${result.profileId}`);
    } catch {
      setError("The event profile could not be saved. Try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form className="grid gap-8" noValidate onSubmit={handleSubmit}>
      {error ? <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-800" role="alert">{error}</p> : null}

      <fieldset className="grid gap-4">
        <legend className="text-xl font-bold">1. Event identity</legend>
        <label className="grid gap-1.5 font-medium">
          Find an existing event
          <select aria-label="Find an existing event" onChange={(event) => setEventId(event.currentTarget.value)} value={eventId}>
            <option value="">Create a new event</option>
            {events.map((item) => <option key={item.id} value={item.id}>{item.name}{item.city && item.region ? ` — ${item.city}, ${item.region}` : ""}</option>)}
          </select>
        </label>
        {!eventId ? <div className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-1.5 font-medium sm:col-span-3">Event name<input name="eventName" required /></label>
          <label className="grid gap-1.5 font-medium sm:col-span-2">City<input name="city" required /></label>
          <label className="grid gap-1.5 font-medium">State<input name="region" maxLength={2} required /></label>
        </div> : null}
      </fieldset>

      <fieldset className="grid gap-4 border-t border-slate-200 pt-6">
        <legend className="text-xl font-bold">2. Contact</legend>
        <label className="grid gap-1.5 font-medium">
          Add an existing contact
          <select aria-label="Add an existing contact" onChange={(event) => { const id = event.currentTarget.value; setContactDrafts((drafts) => drafts.map((draft, index) => index === 0 ? { ...draft, id } : draft)); }} value={contactDrafts[0]?.id ?? ""}>
            <option value="">Create a new contact</option>
            {contacts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.organizationName ? ` — ${item.organizationName}` : ""}</option>)}
          </select>
        </label>
        {contactDrafts.map((draft, index) => <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2" key={index}>
          {index > 0 ? <label className="grid gap-1.5 font-medium sm:col-span-2">Contact {index + 1} (existing)<select aria-label={`Contact ${index + 1} existing contact`} onChange={(event) => { const id = event.currentTarget.value; setContactDrafts((drafts) => drafts.map((item, itemIndex) => itemIndex === index ? { ...item, id } : item)); }} value={draft.id}><option value="">Create a new contact</option>{contacts.map((item) => <option key={item.id} value={item.id}>{item.name}{item.organizationName ? ` — ${item.organizationName}` : ""}</option>)}</select></label> : null}
          {!draft.id ? <><label className="grid gap-1.5 font-medium sm:col-span-2">{index === 0 ? "Contact name" : `Contact ${index + 1} name`}<input name={`contactName-${index}`} required /></label><label className="grid gap-1.5 font-medium">Phone<input defaultValue={draft.phone} name={`phone-${index}`} /></label><label className="grid gap-1.5 font-medium">Email<input name={`email-${index}`} type="email" /></label><label className="grid gap-1.5 font-medium sm:col-span-2">Role (optional)<input name={`role-${index}`} /></label></> : null}
          {index > 0 ? <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => drafts.filter((_, itemIndex) => itemIndex !== index))} type="button">Remove contact</button> : null}
        </div>)}
        <button className="button-secondary justify-self-start" onClick={() => setContactDrafts((drafts) => [...drafts, { id: "", name: "", phone: "", email: "", role: "" }])} type="button">Add another contact</button>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-slate-200 pt-6">
        <legend className="text-xl font-bold">3. Booking (optional)</legend>
        <label className="flex items-center gap-2 font-medium"><input checked={includeBooking} onChange={(event) => setIncludeBooking(event.currentTarget.checked)} type="checkbox" />Create a booking for this event</label>
        {includeBooking ? <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 font-medium sm:col-span-2">Booking name<input name="bookingName" required /></label>
          <label className="grid gap-1.5 font-medium">Next action<select defaultValue="call" name="nextActionKind"><option value="call">Call</option><option value="email">Email</option><option value="prepare_quote">Prepare quote</option></select></label>
          <label className="grid gap-1.5 font-medium">Next follow-up date<input name="nextActionDueAt" required type="date" /></label>
        </div> : null}
      </fieldset>

      <div className="flex justify-end"><button className="button-primary" disabled={isSubmitting} type="submit">{isSubmitting ? "Creating…" : "Create event profile"}</button></div>
    </form>
  );
}
