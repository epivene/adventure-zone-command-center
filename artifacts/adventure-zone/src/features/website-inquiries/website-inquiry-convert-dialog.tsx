import { useMemo, useState, type FormEvent } from "react";

import type { WebsiteInquiryApi } from "./website-inquiry-api";
import type {
  WebsiteInquiryConversionInput,
  WebsiteInquiryConversionResult,
  WebsiteInquiryMatchCandidate,
  WebsiteInquiryMatches,
  WebsiteInquiryRecord,
} from "./types";

type InquirySeed = Pick<
  WebsiteInquiryRecord,
  | "id"
  | "name"
  | "email"
  | "eventName"
  | "eventDate"
  | "eventLocation"
  | "packageInterest"
  | "message"
>;

type ExistingChoice = { mode: "existing"; id: string; label: string };
type NewContact = { mode: "create"; firstName: string; lastName: string; email: string };
type NewOrganization = { mode: "create"; name: string; city: string; region: string };

function splitName(name: string): { firstName: string; lastName: string } {
  const parts = name.trim().split(/\s+/);
  return {
    firstName: parts.shift() ?? "",
    lastName: parts.join(" "),
  };
}

function CandidateList(props: {
  candidates: WebsiteInquiryMatchCandidate[];
  kind: "contact" | "profile";
  onChoose: (candidate: WebsiteInquiryMatchCandidate) => void;
}) {
  if (props.candidates.length === 0) return null;
  return (
    <div className="grid gap-2">
      {props.candidates.map((candidate) => (
        <button
          className="rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-orange-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500"
          key={candidate.id}
          onClick={() => props.onChoose(candidate)}
          type="button"
          aria-label={`Use ${props.kind} ${candidate.label}`}
        >
          <span className="block font-semibold text-slate-900">{candidate.label}</span>
          <span className="block text-xs text-slate-600">
            {candidate.reasons.join(" · ") || "Manual search result"}
          </span>
        </button>
      ))}
    </div>
  );
}

function toIsoDateTime(value: string): string | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function WebsiteInquiryConvertDialog({
  api,
  inquiry,
  matches,
  onClose,
  onConverted,
}: {
  api: WebsiteInquiryApi;
  inquiry: InquirySeed;
  matches: WebsiteInquiryMatches;
  onClose: () => void;
  onConverted: (result: WebsiteInquiryConversionResult) => void;
}) {
  const initialName = useMemo(() => splitName(inquiry.name), [inquiry.name]);
  const [contact, setContact] = useState<ExistingChoice | NewContact>({
    mode: "create",
    ...initialName,
    email: inquiry.email,
  });
  const [organization, setOrganization] = useState<ExistingChoice | NewOrganization>({
    mode: "create",
    name: inquiry.eventName,
    city: matches.parsedLocation?.city ?? "",
    region: matches.parsedLocation?.region ?? "",
  });
  const [bookingName, setBookingName] = useState(inquiry.eventName);
  const [city, setCity] = useState(matches.parsedLocation?.city ?? "");
  const [region, setRegion] = useState(matches.parsedLocation?.region ?? "");
  const [startsAt, setStartsAt] = useState(inquiry.eventDate ? `${inquiry.eventDate}T09:00` : "");
  const [dueAt, setDueAt] = useState("");
  const [notes, setNotes] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [organizationSearch, setOrganizationSearch] = useState("");
  const [contactResults, setContactResults] = useState<WebsiteInquiryMatchCandidate[]>([]);
  const [organizationResults, setOrganizationResults] = useState<WebsiteInquiryMatchCandidate[]>([]);
  const [searching, setSearching] = useState<"contact" | "organization" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState<WebsiteInquiryConversionResult | null>(null);

  async function search(entity: "contact" | "organization", query: string) {
    if (query.trim().length < 2) {
      setError("Enter at least two characters to search.");
      return;
    }
    setSearching(entity);
    setError("");
    try {
      const results = await api.get<WebsiteInquiryMatchCandidate[]>(
        `/website-inquiries/search?entity=${entity}&q=${encodeURIComponent(query.trim())}`,
      );
      if (entity === "contact") setContactResults(results);
      else setOrganizationResults(results);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Search failed.");
    } finally {
      setSearching(null);
    }
  }

  function review(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!bookingName.trim() || !city.trim() || !/^[A-Za-z]{2}$/.test(region.trim())) {
      setConfirming(false);
      setError("Enter a booking name, city and two-letter state.");
      return;
    }
    if (contact.mode === "create" && (!contact.firstName.trim() || !contact.lastName.trim())) {
      setError("Enter the new contact's first and last name.");
      return;
    }
    if (organization.mode === "create" && !organization.name.trim()) {
      setError("Enter the new profile name.");
      return;
    }
    setConfirming(true);
  }

  function payload(): WebsiteInquiryConversionInput {
    const contactInput: WebsiteInquiryConversionInput["contact"] = contact.mode === "existing"
      ? { mode: "existing", id: contact.id }
      : {
          mode: "create",
          firstName: contact.firstName.trim(),
          lastName: contact.lastName.trim(),
          ...(contact.email.trim() ? { email: contact.email.trim() } : {}),
        };
    const organizationInput: WebsiteInquiryConversionInput["organization"] = organization.mode === "existing"
      ? { mode: "existing", id: organization.id }
      : {
          mode: "create",
          name: organization.name.trim(),
          ...(organization.city.trim() ? { city: organization.city.trim() } : {}),
          ...(/^[A-Za-z]{2}$/.test(organization.region.trim()) ? { region: organization.region.trim().toUpperCase() } : {}),
        };
    const startIso = toIsoDateTime(startsAt);
    const dueIso = toIsoDateTime(dueAt);
    return {
      contact: contactInput,
      organization: organizationInput,
      booking: {
        name: bookingName.trim(),
        city: city.trim(),
        region: region.trim().toUpperCase(),
        ...(startIso ? { startsAt: startIso } : {}),
        ...(inquiry.packageInterest ? { packageInterest: inquiry.packageInterest } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      nextAction: { kind: "call", ...(dueIso ? { dueAt: dueIso } : {}) },
    };
  }

  async function convert() {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const result = await api.post<WebsiteInquiryConversionResult>(
        `/website-inquiries/${inquiry.id}/convert`,
        payload(),
      );
      setSuccess(result);
      onConverted(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Conversion failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div aria-labelledby="convert-title" aria-modal="true" className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/55 p-4" role="dialog">
      <div className="mx-auto max-w-3xl rounded-2xl bg-slate-50 p-5 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">CRM conversion</p>
            <h2 className="mt-1 text-2xl font-bold text-slate-950" id="convert-title">Convert inquiry</h2>
            <p className="mt-1 text-sm text-slate-600">Review every match before creating the contact, profile, booking and next call.</p>
          </div>
          <button aria-label="Close conversion" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={onClose} type="button">Close</button>
        </div>

        {error ? <p className="mt-4 rounded-lg bg-rose-100 p-3 text-sm font-semibold text-rose-900" role="alert">{error}</p> : null}
        {success ? (
          <section aria-live="polite" className="mt-5 rounded-xl border border-emerald-300 bg-emerald-50 p-4">
            <h3 className="font-bold text-emerald-950">Inquiry converted</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <a className="rounded-lg bg-emerald-800 px-3 py-2 text-sm font-bold text-white" href={`/bookings/${success.bookingId}`}>Open new booking</a>
              <a className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-bold text-emerald-900" href={`/contacts/${success.contactId}`}>Open contact</a>
              <a className="rounded-lg border border-emerald-700 px-3 py-2 text-sm font-bold text-emerald-900" href={`/profiles/${success.organizationId}`}>Open profile</a>
            </div>
          </section>
        ) : (
          <form className="mt-5 grid gap-6" onSubmit={review}>
            <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <legend className="px-1 font-bold text-slate-900">Contact</legend>
              <CandidateList candidates={matches.contacts} kind="contact" onChoose={(candidate) => setContact({ mode: "existing", id: candidate.id, label: candidate.label })} />
              <button className="w-fit rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => setContact({ mode: "create", ...initialName, email: inquiry.email })} type="button">Create new contact</button>
              {contact.mode === "existing" ? <p className="text-sm font-semibold text-emerald-800">Using {contact.label}</p> : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm font-semibold text-slate-700">First name<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={contact.firstName} onChange={(event) => setContact({ ...contact, firstName: event.target.value })} /></label>
                  <label className="text-sm font-semibold text-slate-700">Last name<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={contact.lastName} onChange={(event) => setContact({ ...contact, lastName: event.target.value })} /></label>
                  <label className="text-sm font-semibold text-slate-700">Email<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" type="email" value={contact.email} onChange={(event) => setContact({ ...contact, email: event.target.value })} /></label>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-52 flex-1 text-sm font-semibold text-slate-700">Search contacts<input aria-label="Search contacts" className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} /></label>
                <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" disabled={searching === "contact"} onClick={() => void search("contact", contactSearch)} type="button">Search contacts</button>
              </div>
              <CandidateList candidates={contactResults} kind="contact" onChoose={(candidate) => setContact({ mode: "existing", id: candidate.id, label: candidate.label })} />
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
              <legend className="px-1 font-bold text-slate-900">Event profile</legend>
              <CandidateList candidates={matches.organizations} kind="profile" onChoose={(candidate) => setOrganization({ mode: "existing", id: candidate.id, label: candidate.label })} />
              <button className="w-fit rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" onClick={() => setOrganization({ mode: "create", name: inquiry.eventName, city, region })} type="button">Create new profile</button>
              {organization.mode === "existing" ? <p className="text-sm font-semibold text-emerald-800">Using {organization.label}</p> : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm font-semibold text-slate-700 sm:col-span-3">New profile name<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={organization.name} onChange={(event) => setOrganization({ ...organization, name: event.target.value })} /></label>
                  <label className="text-sm font-semibold text-slate-700">Profile city<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={organization.city} onChange={(event) => setOrganization({ ...organization, city: event.target.value })} /></label>
                  <label className="text-sm font-semibold text-slate-700">Profile state<input className="mt-1 w-full rounded-lg border border-slate-300 p-2 uppercase" maxLength={2} value={organization.region} onChange={(event) => setOrganization({ ...organization, region: event.target.value.toUpperCase() })} /></label>
                </div>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-52 flex-1 text-sm font-semibold text-slate-700">Search profiles<input aria-label="Search profiles" className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={organizationSearch} onChange={(event) => setOrganizationSearch(event.target.value)} /></label>
                <button className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold" disabled={searching === "organization"} onClick={() => void search("organization", organizationSearch)} type="button">Search profiles</button>
              </div>
              <CandidateList candidates={organizationResults} kind="profile" onChoose={(candidate) => setOrganization({ mode: "existing", id: candidate.id, label: candidate.label })} />
            </fieldset>

            <fieldset className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:grid-cols-2">
              <legend className="px-1 font-bold text-slate-900">Booking and next call</legend>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Booking name<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={bookingName} onChange={(event) => setBookingName(event.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700">City<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" value={city} onChange={(event) => setCity(event.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700">State<input className="mt-1 w-full rounded-lg border border-slate-300 p-2 uppercase" maxLength={2} value={region} onChange={(event) => setRegion(event.target.value.toUpperCase())} /></label>
              <label className="text-sm font-semibold text-slate-700">Event date and time<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700">Call due time (optional)<input className="mt-1 w-full rounded-lg border border-slate-300 p-2" type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
              <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Internal booking notes<textarea className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 p-2" value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
            </fieldset>

            {confirming ? (
              <section className="rounded-xl border-2 border-orange-400 bg-orange-50 p-4" aria-live="polite">
                <h3 className="font-bold text-slate-950">Confirm conversion</h3>
                <p className="mt-1 text-sm text-slate-700">Create the booking “{bookingName}” in {city}, {region.toUpperCase()} and schedule a call follow-up.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="rounded-lg bg-orange-600 px-4 py-2 font-bold text-white disabled:opacity-60" disabled={submitting} onClick={() => void convert()} type="button">{submitting ? "Converting…" : "Confirm conversion"}</button>
                  <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 font-semibold" disabled={submitting} onClick={() => setConfirming(false)} type="button">Keep editing</button>
                </div>
              </section>
            ) : null}
            <button className="rounded-lg bg-slate-900 px-4 py-3 font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500" type="submit">Review conversion</button>
          </form>
        )}
      </div>
    </div>
  );
}
