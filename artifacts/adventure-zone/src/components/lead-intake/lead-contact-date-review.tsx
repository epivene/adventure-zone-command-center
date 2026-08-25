import { useState } from "react";
import type { LeadContactOption, LeadImportReviewRow, LeadProfileOption } from "@/features/lead-intake/lead-intake-client";

type ReviewClient = {
  searchProfiles(query: string): Promise<LeadProfileOption[]>;
  listProfileContacts(organizationId: string): Promise<LeadContactOption[]>;
  confirmReview(rowId: string, body: unknown): Promise<unknown>;
};

export function LeadContactDateReview({
  row,
  client,
  onSaved,
}: {
  row: LeadImportReviewRow;
  client: ReviewClient;
  onSaved: () => Promise<void> | void;
}) {
  const [query, setQuery] = useState([row.company, row.city, row.region].filter(Boolean).join(" "));
  const [profiles, setProfiles] = useState<LeadProfileOption[]>([]);
  const [profile, setProfile] = useState<LeadProfileOption | null>(null);
  const [contacts, setContacts] = useState<LeadContactOption[]>([]);
  const [contactMode, setContactMode] = useState<"existing" | "manual">("existing");
  const [contactId, setContactId] = useState("");
  const [eventName, setEventName] = useState(row.confirmedEventName ?? row.company ?? "");
  const [startDate, setStartDate] = useState(row.confirmedStartDate ?? "");
  const [endDate, setEndDate] = useState(row.confirmedEndDate ?? "");
  const [contactName, setContactName] = useState(row.confirmedContactName ?? "");
  const [contactRole, setContactRole] = useState(row.confirmedContactRole ?? "");
  const [recipientEmail, setRecipientEmail] = useState(row.confirmedRecipientEmail ?? "");
  const [emailSourceKind, setEmailSourceKind] = useState("crm_contact");
  const [emailSource, setEmailSource] = useState("");
  const [dateSourceKind, setDateSourceKind] = useState("official_website");
  const [dateSource, setDateSource] = useState("");
  const [recipientConfirmed, setRecipientConfirmed] = useState(row.recipientConfirmed);
  const [introductionSuitable, setIntroductionSuitable] = useState(row.introductionSuitable);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true); setError("");
    try { setProfiles(await client.searchProfiles(query.trim())); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not search profiles."); }
    finally { setBusy(false); }
  }

  async function chooseProfile(option: LeadProfileOption) {
    setProfile(option); setProfiles([]); setBusy(true); setError("");
    try { setContacts(await client.listProfileContacts(option.id)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load profile contacts."); }
    finally { setBusy(false); }
  }

  function chooseContact(value: string) {
    setContactId(value);
    if (value === "manual") {
      setContactMode("manual"); setContactName(""); setContactRole(""); setRecipientEmail("");
      setEmailSourceKind("manual"); setEmailSource("");
      return;
    }
    setContactMode("existing");
    const contact = contacts.find((item) => item.id === value);
    if (!contact) return;
    setContactName([contact.firstName, contact.lastName].filter(Boolean).join(" "));
    setContactRole(contact.role ?? contact.jobTitle ?? "");
    setRecipientEmail(contact.email ?? "");
    setEmailSourceKind("crm_contact");
    setEmailSource(`contact:${contact.id}`);
    setRecipientConfirmed(false);
  }

  const ready = Boolean(
    profile && eventName.trim() && startDate && endDate && contactName.trim() && contactRole.trim() &&
    recipientEmail.trim() && emailSource.trim() && dateSource.trim() && recipientConfirmed && introductionSuitable &&
    (contactMode === "manual" || contactId),
  );

  async function save() {
    if (!ready || !profile || busy) return;
    setBusy(true); setError("");
    try {
      await client.confirmReview(row.id, {
        expectedVersion: row.reviewVersion,
        decision: {
          organizationId: profile.id,
          contactMode,
          contactId: contactMode === "existing" ? contactId : null,
          contactName: contactName.trim(),
          contactRole: contactRole.trim(),
          recipientEmail: recipientEmail.trim(),
          recipientConfirmed,
          introductionSuitable,
          eventName: eventName.trim(),
          startDate,
          endDate,
          emailEvidence: { sourceKind: emailSourceKind, sourceReference: emailSource.trim() },
          dateEvidence: { sourceKind: dateSourceKind, sourceReference: dateSource.trim() },
          candidateEmails: contacts.map((item) => item.email).filter((value): value is string => Boolean(value)),
        },
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify this event and contact.");
    } finally { setBusy(false); }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-orange-200 bg-white p-4 shadow-sm">
      <div><h3 className="text-lg font-bold">Verify event and introduction contact</h3><p className="text-sm text-slate-600">Suggestions do not count as confirmation. Check the actual 2026 event source and intended recipient.</p></div>
      <div className="flex gap-2"><input aria-label="Profile search" className="min-w-0 flex-1" onChange={(event) => setQuery(event.currentTarget.value)} value={query}/><button className="button-secondary" disabled={busy || !query.trim()} onClick={() => void search()} type="button">Search profiles</button></div>
      {profiles.length ? <div className="grid gap-2">{profiles.map((option) => <button className="rounded-lg border p-3 text-left" key={option.id} onClick={() => void chooseProfile(option)} type="button"><span className="font-semibold">{option.name}</span><span className="ml-2 text-sm text-slate-600">{[option.city, option.region].filter(Boolean).join(", ")}</span></button>)}</div> : null}
      {profile ? <p className="rounded-lg bg-emerald-50 p-3 text-sm"><span className="font-semibold">Selected profile:</span> {profile.name}</p> : null}
      {profile ? <label className="grid gap-1 text-sm font-semibold">Existing contact<select aria-label="Existing contact" onChange={(event) => chooseContact(event.currentTarget.value)} value={contactId}><option value="">Choose a contact</option>{contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.firstName, contact.lastName].join(" ")} · {contact.role ?? contact.jobTitle ?? "Role unknown"}</option>)}<option value="manual">Manual reviewed contact</option></select></label> : null}
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Confirmed profile/event name<input aria-label="Confirmed profile/event name" onChange={(event) => setEventName(event.currentTarget.value)} value={eventName}/></label><label className="grid gap-1 text-sm font-semibold">Contact name<input aria-label="Contact name" onChange={(event) => setContactName(event.currentTarget.value)} value={contactName}/></label><label className="grid gap-1 text-sm font-semibold">Event start date<input aria-label="Event start date" onChange={(event) => setStartDate(event.currentTarget.value)} type="date" value={startDate}/></label><label className="grid gap-1 text-sm font-semibold">Event end date<input aria-label="Event end date" onChange={(event) => setEndDate(event.currentTarget.value)} type="date" value={endDate}/></label><label className="grid gap-1 text-sm font-semibold">Contact role<input aria-label="Contact role" onChange={(event) => setContactRole(event.currentTarget.value)} value={contactRole}/></label><label className="grid gap-1 text-sm font-semibold">Recipient email<input aria-label="Recipient email" onChange={(event) => { setRecipientEmail(event.currentTarget.value); setRecipientConfirmed(false); }} type="email" value={recipientEmail}/></label></div>
      <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-sm font-semibold">Date evidence type<select aria-label="Date evidence type" onChange={(event) => setDateSourceKind(event.currentTarget.value)} value={dateSourceKind}><option value="official_website">Official website</option><option value="act_description">ACT description</option><option value="crm_contact">CRM</option><option value="manual">Manual</option></select></label><label className="grid gap-1 text-sm font-semibold">Date source<input aria-label="Date source" onChange={(event) => setDateSource(event.currentTarget.value)} placeholder="URL or record reference" value={dateSource}/></label><label className="grid gap-1 text-sm font-semibold">Email evidence type<select aria-label="Email evidence type" onChange={(event) => setEmailSourceKind(event.currentTarget.value)} value={emailSourceKind}><option value="crm_contact">CRM contact</option><option value="act_description">ACT description</option><option value="official_website">Official website</option><option value="manual">Manual</option></select></label><label className="grid gap-1 text-sm font-semibold">Email source<input aria-label="Email source" onChange={(event) => setEmailSource(event.currentTarget.value)} placeholder="URL or record reference" value={emailSource}/></label></div>
      <label className="flex items-start gap-2 text-sm font-semibold"><input checked={recipientConfirmed} onChange={(event) => setRecipientConfirmed(event.currentTarget.checked)} type="checkbox"/>I confirmed this recipient email</label>
      <label className="flex items-start gap-2 text-sm font-semibold"><input checked={introductionSuitable} onChange={(event) => setIntroductionSuitable(event.currentTarget.checked)} type="checkbox"/>This contact is appropriate for an introduction email</label>
      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}
      <button className="button-primary justify-self-start" disabled={!ready || busy} onClick={() => void save()} type="button">{busy ? "Saving…" : "Verify event and contact"}</button>
    </section>
  );
}
