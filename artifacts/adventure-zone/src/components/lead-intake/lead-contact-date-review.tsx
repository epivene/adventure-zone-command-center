import { useEffect, useState } from "react";
import type {
  LeadContactOption,
  LeadImportReviewRow,
  LeadProfileEvidence,
  LeadProfileOption,
  LeadRelationshipClassification,
} from "@/features/lead-intake/lead-intake-client";
import { LeadRelationshipReview } from "./lead-relationship-review";

type ContactMode = "existing" | "manual" | "organization_inbox";

type ReviewClient = {
  searchProfiles(query: string): Promise<LeadProfileOption[]>;
  listProfileContacts(organizationId: string): Promise<LeadContactOption[]>;
  getProfileEvidence(organizationId: string): Promise<LeadProfileEvidence>;
  confirmReview(rowId: string, body: unknown): Promise<unknown>;
  classifyRelationship(rowId: string, expectedVersion: number): Promise<LeadRelationshipClassification>;
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
  const [profileEvidence, setProfileEvidence] = useState<LeadProfileEvidence | null>(null);
  const [contacts, setContacts] = useState<LeadContactOption[]>([]);
  const [contactMode, setContactMode] = useState<ContactMode>("existing");
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
  const [recipientConflictResolved, setRecipientConflictResolved] = useState(false);
  const [introductionSuitable, setIntroductionSuitable] = useState(row.introductionSuitable);
  const [busy, setBusy] = useState(false);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [error, setError] = useState("");

  function clearRecipientApproval() {
    setRecipientConfirmed(false);
    setRecipientConflictResolved(false);
    setIntroductionSuitable(false);
  }

  useEffect(() => {
    setQuery([row.company, row.city, row.region].filter(Boolean).join(" "));
    setProfiles([]);
    setProfile(null);
    setProfileEvidence(null);
    setContacts([]);
    setContactMode("existing");
    setContactId("");
    setEventName(row.confirmedEventName ?? row.company ?? "");
    setStartDate(row.confirmedStartDate ?? "");
    setEndDate(row.confirmedEndDate ?? "");
    setContactName(row.confirmedContactName ?? "");
    setContactRole(row.confirmedContactRole ?? "");
    setRecipientEmail(row.confirmedRecipientEmail ?? "");
    setEmailSourceKind("crm_contact");
    setEmailSource("");
    setDateSourceKind("official_website");
    setDateSource("");
    setRecipientConfirmed(row.recipientConfirmed);
    setRecipientConflictResolved(false);
    setIntroductionSuitable(row.introductionSuitable);
    setError("");
  }, [row.id]);

  async function search() {
    if (!query.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      setProfiles(await client.searchProfiles(query.trim()));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not search profiles.");
    } finally {
      setBusy(false);
    }
  }

  async function chooseProfile(option: LeadProfileOption) {
    setProfile(option);
    setProfiles([]);
    setContacts([]);
    setProfileEvidence(null);
    setBusy(true);
    setEvidenceLoading(true);
    setError("");
    setContactMode("existing");
    setContactId("");
    setContactName("");
    setContactRole("");
    setRecipientEmail("");
    setEmailSourceKind("crm_contact");
    setEmailSource("");
    clearRecipientApproval();
    try {
      const [contactsResult, evidenceResult] = await Promise.allSettled([
        client.listProfileContacts(option.id),
        client.getProfileEvidence(option.id),
      ]);
      const failures: string[] = [];
      if (contactsResult.status === "fulfilled") setContacts(contactsResult.value);
      else failures.push(contactsResult.reason instanceof Error ? contactsResult.reason.message : "Could not load profile contacts.");
      if (evidenceResult.status === "fulfilled") setProfileEvidence(evidenceResult.value);
      else failures.push(evidenceResult.reason instanceof Error ? evidenceResult.reason.message : "Could not load ACT profile evidence.");
      if (failures.length) setError(failures.join(" "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load profile contacts and ACT evidence.");
    } finally {
      setBusy(false);
      setEvidenceLoading(false);
    }
  }

  function chooseMode(mode: ContactMode) {
    setContactMode(mode);
    setContactId("");
    setContactName("");
    setContactRole("");
    setRecipientEmail("");
    setEmailSourceKind(mode === "existing" ? "crm_contact" : "manual");
    setEmailSource("");
    clearRecipientApproval();
  }

  function chooseContact(value: string) {
    if (value === "manual") {
      chooseMode("manual");
      return;
    }
    setContactMode("existing");
    setContactId(value);
    const contact = contacts.find((item) => item.id === value);
    if (!contact) {
      setContactName("");
      setContactRole("");
      setRecipientEmail("");
      setEmailSource("");
      clearRecipientApproval();
      return;
    }
    setContactName([contact.firstName, contact.lastName].filter(Boolean).join(" "));
    setContactRole(contact.role ?? contact.jobTitle ?? "");
    setRecipientEmail(contact.email ?? "");
    setEmailSourceKind("crm_contact");
    setEmailSource(`contact:${contact.id}`);
    clearRecipientApproval();
  }

  function chooseEvidenceEmail(candidate: LeadProfileEvidence["emailCandidates"][number]) {
    setContactMode("organization_inbox");
    setContactId("");
    setContactName("");
    setContactRole("");
    setRecipientEmail(candidate.email);
    setEmailSourceKind("act_description");
    setEmailSource(`act:${candidate.sourceRecordId}:version:${candidate.sourceVersionId}:path:${candidate.sourcePath}`);
    clearRecipientApproval();
  }

  const candidateEmails = [...new Set(
    contacts.map((item) => item.email?.trim().toLowerCase()).filter((value): value is string => Boolean(value)),
  )];
  const normalizedRecipient = recipientEmail.trim().toLowerCase();
  const recipientConflict = contactMode !== "existing"
    && candidateEmails.length > 1
    && !candidateEmails.includes(normalizedRecipient);
  const selectedContact = contacts.find((item) => item.id === contactId);
  const existingRecipientMatches = contactMode !== "existing" || Boolean(
    selectedContact?.email && selectedContact.email.trim().toLowerCase() === normalizedRecipient,
  );
  const personFieldsReady = contactMode === "organization_inbox"
    || Boolean(contactName.trim() && contactRole.trim());

  const ready = Boolean(
    profile && eventName.trim() && startDate && endDate && personFieldsReady
    && recipientEmail.trim() && emailSource.trim() && dateSource.trim()
    && recipientConfirmed && introductionSuitable && existingRecipientMatches
    && (!recipientConflict || recipientConflictResolved)
    && (contactMode !== "existing" || contactId),
  );

  async function save() {
    if (!ready || !profile || busy) return;
    setBusy(true);
    setError("");
    try {
      await client.confirmReview(row.id, {
        expectedVersion: row.reviewVersion,
        decision: {
          organizationId: profile.id,
          contactMode,
          contactId: contactMode === "existing" ? contactId : null,
          contactName: contactMode === "organization_inbox" ? "" : contactName.trim(),
          contactRole: contactMode === "organization_inbox" ? "" : contactRole.trim(),
          recipientEmail: recipientEmail.trim(),
          recipientConfirmed,
          recipientConflictResolved,
          introductionSuitable,
          eventName: eventName.trim(),
          startDate,
          endDate,
          emailEvidence: { sourceKind: emailSourceKind, sourceReference: emailSource.trim() },
          dateEvidence: { sourceKind: dateSourceKind, sourceReference: dateSource.trim() },
        },
      });
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify this event and contact.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-4 rounded-xl border border-orange-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-lg font-bold">Verify event and introduction contact</h3>
        <p className="text-sm text-slate-600">Suggestions do not count as confirmation. Check the actual 2026 event source and intended recipient.</p>
      </div>
      <div className="flex gap-2">
        <input aria-label="Profile search" className="min-w-0 flex-1" onChange={(event) => setQuery(event.currentTarget.value)} value={query}/>
        <button className="button-secondary" disabled={busy || !query.trim()} onClick={() => void search()} type="button">Search profiles</button>
      </div>
      {profiles.length ? (
        <div className="grid gap-2">
          {profiles.map((option) => (
            <button className="rounded-lg border p-3 text-left" key={option.id} onClick={() => void chooseProfile(option)} type="button">
              <span className="font-semibold">{option.name}</span>
              <span className="ml-2 text-sm text-slate-600">{[option.city, option.region].filter(Boolean).join(", ")}</span>
            </button>
          ))}
        </div>
      ) : null}
      {profile ? <p className="rounded-lg bg-emerald-50 p-3 text-sm"><span className="font-semibold">Selected profile:</span> {profile.name}</p> : null}

      {evidenceLoading ? <p className="text-sm text-slate-600">Loading profile details and ACT evidence…</p> : null}
      {profileEvidence ? (
        <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 text-sm">
          <div>
            <p className="font-semibold">Profile details</p>
            <p>{[profileEvidence.organization.city, profileEvidence.organization.region].filter(Boolean).join(", ") || "Location not set"}</p>
            <p>{profileEvidence.organization.phone ?? "Phone not set"}</p>
            {profileEvidence.organization.website ? <a href={profileEvidence.organization.website} rel="noreferrer" target="_blank">{profileEvidence.organization.website}</a> : <p>Website not set</p>}
          </div>
          {profileEvidence.actText.length ? profileEvidence.actText.map((item) => (
            <div className="rounded-lg border bg-white p-3" key={`${item.sourceRecordId}:${item.sourceVersionId}:${item.sourcePath}`}>
              <p className="font-semibold">ACT {item.kind === "business_card" ? "Business Card" : "Description"}</p>
              <p className="whitespace-pre-wrap">{item.originalText}</p>
              <p className="mt-1 text-xs text-slate-500">{item.sourcePath}</p>
            </div>
          )) : <p>No ACT Description or Business Card evidence was found for this profile.</p>}
        </div>
      ) : null}

      {profile ? (
        <div className="flex flex-wrap gap-2" aria-label="Recipient mode">
          <button className={contactMode === "existing" ? "button-primary" : "button-secondary"} onClick={() => chooseMode("existing")} type="button">Existing contact</button>
          <button className={contactMode === "organization_inbox" ? "button-primary" : "button-secondary"} onClick={() => chooseMode("organization_inbox")} type="button">Organization inbox</button>
          <button className={contactMode === "manual" ? "button-primary" : "button-secondary"} onClick={() => chooseMode("manual")} type="button">Manual person</button>
        </div>
      ) : null}

      {profile && contactMode === "existing" ? (
        <label className="grid gap-1 text-sm font-semibold">Existing contact
          <select aria-label="Existing contact" onChange={(event) => chooseContact(event.currentTarget.value)} value={contactId}>
            <option value="">Choose a contact</option>
            {contacts.map((contact) => <option key={contact.id} value={contact.id}>{[contact.firstName, contact.lastName].join(" ")} · {contact.role ?? contact.jobTitle ?? "Role unknown"}</option>)}
            <option value="manual">Manual reviewed contact</option>
          </select>
        </label>
      ) : null}

      {contactMode === "organization_inbox" ? (
        <div className="grid gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
          <p className="font-semibold">Organization inbox</p>
          <p className="text-sm">Use this only when the verified recipient is the organization itself and no named person is known.</p>
          <div className="flex flex-wrap gap-2">
            {profileEvidence?.emailCandidates.map((candidate) => (
              <button className="button-secondary" key={`${candidate.email}:${candidate.sourcePath}`} onClick={() => chooseEvidenceEmail(candidate)} type="button">
                {candidate.email}
              </button>
            ))}
          </div>
          <div className="rounded-lg bg-white p-3"><p className="text-xs font-semibold uppercase text-slate-500">Greeting preview</p><p>Hi,</p></div>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Confirmed profile/event name<input aria-label="Confirmed profile/event name" onChange={(event) => setEventName(event.currentTarget.value)} value={eventName}/></label>
        {contactMode !== "organization_inbox" ? <label className="grid gap-1 text-sm font-semibold">Contact name<input aria-label="Contact name" onChange={(event) => { setContactName(event.currentTarget.value); setIntroductionSuitable(false); }} value={contactName}/></label> : null}
        <label className="grid gap-1 text-sm font-semibold">Event start date<input aria-label="Event start date" onChange={(event) => setStartDate(event.currentTarget.value)} type="date" value={startDate}/></label>
        <label className="grid gap-1 text-sm font-semibold">Event end date<input aria-label="Event end date" onChange={(event) => setEndDate(event.currentTarget.value)} type="date" value={endDate}/></label>
        {contactMode !== "organization_inbox" ? <label className="grid gap-1 text-sm font-semibold">Contact role<input aria-label="Contact role" onChange={(event) => { setContactRole(event.currentTarget.value); setIntroductionSuitable(false); }} value={contactRole}/></label> : null}
        <label className="grid gap-1 text-sm font-semibold">Recipient email<input aria-label="Recipient email" onChange={(event) => { setRecipientEmail(event.currentTarget.value); clearRecipientApproval(); }} type="email" value={recipientEmail}/></label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold">Date evidence type<select aria-label="Date evidence type" onChange={(event) => { setDateSourceKind(event.currentTarget.value); clearRecipientApproval(); }} value={dateSourceKind}><option value="official_website">Official website</option><option value="act_description">ACT description</option><option value="crm_contact">CRM</option><option value="manual">Manual</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">Date source<input aria-label="Date source" onChange={(event) => { setDateSource(event.currentTarget.value); clearRecipientApproval(); }} placeholder="URL or record reference" value={dateSource}/></label>
        <label className="grid gap-1 text-sm font-semibold">Email evidence type<select aria-label="Email evidence type" onChange={(event) => { setEmailSourceKind(event.currentTarget.value); clearRecipientApproval(); }} value={emailSourceKind}><option value="crm_contact">CRM contact</option><option value="act_description">ACT description</option><option value="official_website">Official website</option><option value="manual">Manual</option></select></label>
        <label className="grid gap-1 text-sm font-semibold">Email source<input aria-label="Email source" onChange={(event) => { setEmailSource(event.currentTarget.value); clearRecipientApproval(); }} placeholder="URL or record reference" value={emailSource}/></label>
      </div>
      <label className="flex items-start gap-2 text-sm font-semibold"><input aria-label="I confirmed this recipient email" checked={recipientConfirmed} onChange={(event) => setRecipientConfirmed(event.currentTarget.checked)} type="checkbox"/>I confirmed this recipient email</label>
      {recipientConflict ? <label className="flex items-start gap-2 text-sm font-semibold"><input aria-label="I reviewed the other profile emails and deliberately selected this recipient" checked={recipientConflictResolved} onChange={(event) => setRecipientConflictResolved(event.currentTarget.checked)} type="checkbox"/>I reviewed the other profile emails and deliberately selected this recipient</label> : null}
      <label className="flex items-start gap-2 text-sm font-semibold"><input aria-label="This contact is appropriate for an introduction email" checked={introductionSuitable} onChange={(event) => setIntroductionSuitable(event.currentTarget.checked)} type="checkbox"/>This contact is appropriate for an introduction email</label>
      {error ? <p className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700" role="alert">{error}</p> : null}
      <button className="button-primary justify-self-start" disabled={!ready || busy} onClick={() => void save()} type="button">{busy ? "Saving…" : "Verify event and contact"}</button>
      {row.state === "verified" ? (
        <LeadRelationshipReview client={client} onClassified={onSaved} row={row} />
      ) : null}
    </section>
  );
}
