import { ProfileLegOperations } from '@/components/bookings/profile-leg-operations';
import { ownerOperationsClient } from '@/features/bookings/booking-leg-operations-client';
import { useBookingOperationsRevision } from '@/features/bookings/booking-operations-changes';
import { ProfileWorkActivity } from "@/features/booking-work/ProfileWorkActivity";
import { ProfilePageFrame } from "@/components/profiles/profile-page-frame";
import { useWorkspaceSession } from "@/features/assistant-workspace/WorkspaceSessionProvider";
import { FollowUpDialog } from "@/components/follow-ups/follow-up-dialog";
import { profileReturnPath, profileOriginLabel } from "@/lib/profile-navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConventionHistory } from "@/components/profiles/convention-history";
import { useLocation, useParams, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import { EarlyBirdPromoCard, type EarlyBirdPromoView } from "@/components/event-profiles/early-bird-promo-card";
import { SimpleFullProfile, type OpenSection } from "@/components/profiles/simple-full-profile";
import { ProfileResearchPanel } from "@/components/profiles/profile-research-panel";
import { ScoutNotesPanel } from "@/components/profiles/scout-notes-panel";
import { AttendanceHistoryPanel } from "@/components/profiles/attendance-history-panel";
import { ProfileDocuments } from "@/components/profiles/profile-documents";
import { HistoricalEventDates } from "@/components/profiles/historical-event-dates";
import { simplifyHistoryText } from "@/components/profiles/history-summary";
import { PaperNoteHistorySources } from "@/components/paper-notes/paper-note-history-sources";
import { AssistantContextRegistration } from "@/components/assistant/assistant-context-registration";
import { DerivedFactsReview } from "@/components/assistant/derived-facts-review";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { extractHistoricalEventDates } from "@/features/event-profiles/historical-event-dates";
import { listFamilyNotes } from "@/actions/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";
import { readProfileOriginLabel } from "@/lib/profile-navigation";
import { ContractAction } from "@/components/contracts/contract-action";
import { ContractHistoryCard } from "@/components/contracts/contract-history-card";
import { contractClient } from "@/features/contracts/contract-client";
import type { ContractVersion } from "@/features/contracts/contract-types";
import { OutreachProfileSummary } from "@/components/today/outreach-planner";
import { InvoiceContractSummaryCard } from "@/components/invoices/invoice-contract-summary-card";
import { contractsWorkspaceApi, invoicesApi } from "@/lib/invoices-api";
import { businessDocumentsApi } from "@/lib/business-documents-api";
import { ProfileBookingCreator } from "@/components/profiles/profile-booking-creator";

const ACT_PREVIEW_LENGTH = 280;

export default function EventProfilePage() {
  const { profileId } = useParams<{ profileId: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { openProfile } = useWorkspaceSession();
  const [data, setData] = useState<any>(null);
  const [profileSection, setProfileSection] = useState<OpenSection>(null);
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [actHistorySearch, setActHistorySearch] = useState("");
  const [expandedActNotes, setExpandedActNotes] = useState<Set<string>>(() => new Set());
  const [callablePhoneByContactId, setCallablePhoneByContactId] = useState<Record<string, string | null>>({});
  const [familyNotes, setFamilyNotes] = useState<ScopedNoteView[]>([]);
  const [familyNotesError, setFamilyNotesError] = useState<string | null>(null);
  const [profileOrigin, setProfileOrigin] = useState("Profiles");
  const [contractBookings, setContractBookings] = useState<Array<{ id: string; name: string; openDraftId: string | null }>>([]);
  const [contractVersions, setContractVersions] = useState<ContractVersion[]>([]);
  const revision = useBookingOperationsRevision();
  const readGeneration = useRef(0);

  const params = new URLSearchParams(search);
  const contactId = params.get("contactId") ?? undefined;
  const bookingId = params.get("bookingId") ?? undefined;
  const followUpId = params.get("followUpId") ?? undefined;
  const researchRequested = params.get("research") === "1";
  const requestedAction = params.get("action");
  const action = requestedAction === "call" || requestedAction === "follow-up"
    ? (requestedAction as "call" | "follow-up")
    : undefined;
  const mode = params.get("mode") === "prospect" ? "prospect" as const : undefined;
  useEffect(() => { if(action === "follow-up") setFollowUpOpen(true); }, [action, profileId]);
  function changeFollowUpOpen(open: boolean) {
    setFollowUpOpen(open);
    if(!open && action === "follow-up") {
      const next=new URLSearchParams(search); next.delete("action");
      setLocation(`/profiles/${profileId}${next.size ? `?${next}` : ""}`, {replace:true});
    }
  }

  async function loadProfile() {
    if (!profileId) return;
    const generation = ++readGeneration.current;
    const qs = new URLSearchParams();
    if (contactId) qs.set("contactId", contactId);
    try {
      const [d, ratingSummary, descriptionResult, earlyBirdPromoResult] = await Promise.all([
        apiGet<any>(`/event-profiles/${profileId}?${qs.toString()}`),
        apiGet<{ average: number | null; count: number }>(`/event-wrap-up-ratings/organization/${profileId}`).catch(() => ({ average: null, count: 0 })),
        apiGet<{ description: string | null }>(`/event-profiles/${profileId}/description`).catch(() => ({ description: null })),
        apiGet<{ promotion: EarlyBirdPromoView | null }>(`/early-bird-promo/profile/${profileId}?eventYear=2027`).catch(() => ({ promotion: null })),
      ]);
      const toDate = (value: any) => (value ? new Date(value) : null);
      const normalized = {
        ...d,
        place: {
          ...(d.place ?? {}),
          description: descriptionResult.description ?? null,
        },
        wrapUpRatingSummary: ratingSummary,
        earlyBirdPromo: earlyBirdPromoResult.promotion,
        notes: (d.notes ?? []).map((note: any) => ({
          ...note,
          body: note.importedFromAct ? simplifyHistoryText(String(note.body ?? "")) : note.body,
          occurredAt: toDate(note.occurredAt),
          createdAt: toDate(note.createdAt),
          updatedAt: toDate(note.updatedAt),
        })),
        scoutNotes: (d.scoutNotes ?? []).map((note: any) => ({
          ...note,
          occurredAt: toDate(note.occurredAt),
        })),
        followUps: (d.followUps ?? []).map((followUp: any) => ({ ...followUp, dueAt: toDate(followUp.dueAt), completedAt: toDate(followUp.completedAt) })),
        bookings: (d.bookings ?? []).map((booking: any) => ({ ...booking, startsAt: toDate(booking.startsAt), endsAt: toDate(booking.endsAt) })),
      };

      const callablePhones = await Promise.all((normalized.contacts ?? []).map(async (contact: any) => {
        const detail = await apiGet<any>(`/contacts/${contact.id}/edit-data`).catch(() => null);
        if (!detail) return [contact.id as string, null] as const;
        const phones = Array.isArray(detail?.phones) ? detail.phones : [];
        const callablePhone = phones
          .filter((phone: any) => !phone.doNotCallAt && typeof phone.number === "string" && phone.number.trim())
          .toSorted((left: any, right: any) => Number(Boolean(right.primary)) - Number(Boolean(left.primary)))[0];
        return [contact.id as string, callablePhone?.number ?? null] as const;
      }));

      if (generation !== readGeneration.current) return;
      setCallablePhoneByContactId(Object.fromEntries(callablePhones));
      setFamilyNotes([]);
      setFamilyNotesError(null);
      if (normalized.familyContext?.kind === "event_family") {
        listFamilyNotes(normalized.familyContext.id).then(value => { if (generation === readGeneration.current) setFamilyNotes(value); }).catch(() => { if (generation === readGeneration.current) setFamilyNotesError("Could not load family notes."); });
      }
      setData(normalized);
      setError(null);
    } catch (reason: any) {
      if (generation === readGeneration.current) setError(reason.message);
    } finally {
      if (generation === readGeneration.current) setLoading(false);
    }
  }

  useEffect(() => { void loadProfile(); return () => { readGeneration.current++; }; }, [profileId, contactId, revision]);
  useEffect(() => {
    setProfileOrigin(profileOriginLabel(profileReturnPath(search)));
  }, [profileId]);
  useEffect(() => {
    if (researchRequested && data && !profileEditing) setResearchOpen(true);
  }, [researchRequested, Boolean(data), profileEditing]);
  useEffect(() => {
    if (!profileId || !data) return;
    let cancelled = false;
    contractClient.listOrganization(profileId).then((result) => {
      if (!cancelled) {
        setContractBookings(result.eligibleBookings);
        setContractVersions(result.contracts);
      }
    }).catch(() => { if (!cancelled) { setContractBookings([]); setContractVersions([]); } });
    return () => { cancelled = true; };
  }, [profileId, Boolean(data)]);

  function retryFamilyNotes() {
    if (data?.familyContext?.kind !== "event_family") return;
    setFamilyNotesError(null);
    void listFamilyNotes(data.familyContext.id).then(setFamilyNotes).catch(() => setFamilyNotesError("Could not load family notes."));
  }

  function goBack() {
    if (profileEditing) {
      setProfileEditing(false);
      return;
    }
    setLocation(profileReturnPath(search));
  }

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Loading profile…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const recoveredActNotes = [...new Set(
    (Array.isArray(data.migrationHistory?.notes) ? data.migrationHistory.notes : [])
      .filter((note: unknown): note is string => typeof note === "string")
      .map((note: string) => simplifyHistoryText(note.trim()))
      .filter(Boolean),
  )];
  const historicalEventDates = extractHistoricalEventDates(recoveredActNotes);
  const normalizedActSearch = actHistorySearch.trim().toLowerCase();
  const filteredActNotes = normalizedActSearch
    ? recoveredActNotes.filter((note) => note.toLowerCase().includes(normalizedActSearch))
    : recoveredActNotes;
  const profileLabel = String(data.name ?? data.organization?.name ?? data.place?.name ?? "Profile");

  function toggleActNote(note: string) {
    setExpandedActNotes((current) => {
      const next = new Set(current);
      if (next.has(note)) next.delete(note);
      else next.add(note);
      return next;
    });
  }

  return (
    <ProfilePageFrame>
        <FollowUpDialog key={profileId} open={followUpOpen} onOpenChange={changeFollowUpOpen} profileId={profileId} profileName={profileLabel} contactId={contactId ?? data.selectedContactId} bookingId={bookingId} onSaved={() => { void loadProfile(); }} />
        {profileId ? <AssistantContextRegistration kind="organization" label={profileLabel} recordId={profileId} /> : null}

        <div>
          <SimpleFullProfile
            profile={data}
            onSectionChange={setProfileSection}
            onProfileSaved={loadProfile}
            ratingSummary={data.wrapUpRatingSummary ?? { average: null, count: 0 }}
            onFollowUp={() => setFollowUpOpen(true)}
            onAskAssistant={() => { if(profileId) void openProfile(profileId, profileLabel); }}
            onBack={goBack}
            originLabel={profileOrigin}
            editing={profileEditing}
            onEditingChange={setProfileEditing}
          />
        </div>

        {profileSection === "events" ? <>
        {contractBookings.length || contractVersions.length ? <section className="rounded-xl border border-[#d8dfd6] bg-white p-4 shadow-sm">
          <h2 className="font-bold">Contracts</h2>
          <p className="mb-3 mt-1 text-sm text-[#58717a]">Create one from an event booking, or continue the unfinished draft.</p>
          {contractBookings.length ? <ContractAction bookings={contractBookings} /> : null}
          {contractVersions.length ? <div className="mt-4 grid gap-3">
            {contractVersions.map((contract) => <ContractHistoryCard key={contract.id} version={contract} />)}
          </div> : null}
        </section> : null}

        {profileId && data.place?.city && data.place?.region ? <ProfileBookingCreator city={data.place.city} onCreated={loadProfile} profileId={profileId} region={data.place.region} /> : null}

        {profileId ? <InvoiceContractSummaryCard contractApi={contractsWorkspaceApi} documentApi={businessDocumentsApi} invoiceApi={invoicesApi} organizationId={profileId} /> : null}

        </> : null}
        {!profileEditing && data.earlyBirdPromo ? (
          <EarlyBirdPromoCard
            promotion={data.earlyBirdPromo}
            onChanged={(promotion) => setData((current: any) => ({ ...current, earlyBirdPromo: promotion }))}
          />
        ) : null}

        {!profileEditing && profileId ? <ProfileWorkActivity profileId={profileId} /> : null}
        {!profileEditing && profileId ? <ProfileLegOperations profileId={profileId} client={ownerOperationsClient} role="owner" search={search} onSearchChange={(query) => setLocation(`/profiles/${profileId}?${query}`, { replace: true })} /> : null}
        {!profileEditing && profileId ? <OutreachProfileSummary organizationId={profileId} /> : null}

        {!profileEditing && profileSection === "documents" && profileId ? <ProfileDocuments profileId={profileId} /> : null}
        {profileSection === "notes" ? <>
        {!profileEditing ? <ScoutNotesPanel notes={data.scoutNotes ?? []} /> : null}

        {!profileEditing && profileId ? <AttendanceHistoryPanel mode="owner" profileId={profileId} /> : null}
        {!profileEditing && profileId ? <ConventionHistory profileId={profileId} /> : null}

        </> : null}
        {researchOpen && profileId ? <ProfileResearchPanel profileId={profileId} contactId={contactId ?? data.selectedContactId ?? null} onClose={() => setResearchOpen(false)} onApplied={loadProfile} /> : null}

        {!profileEditing && profileId ? <DerivedFactsReview organizationId={profileId} /> : null}

        {profileSection === "notes" ? <>
        {!profileEditing && profileId ? <PaperNoteHistorySources profileId={profileId} /> : null}

        {!profileEditing ? <HistoricalEventDates dates={historicalEventDates} /> : null}

        {recoveredActNotes.length ? (
          <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer font-semibold text-slate-800">Imported ACT history ({recoveredActNotes.length})</summary>
          <p className="mt-2 text-sm text-slate-600">Original imported records are preserved here for reference.</p>
          <input
            aria-label="Search imported ACT history"
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="Search imported ACT history"
            value={actHistorySearch}
            onChange={(event) => setActHistorySearch(event.target.value)}
          />
          <div className="mt-3 max-h-96 overflow-y-auto pr-1">
            {filteredActNotes.length ? (
              <ul className="grid gap-2">
                {filteredActNotes.map((note: string) => {
                  const expanded = expandedActNotes.has(note);
                  const long = note.length > ACT_PREVIEW_LENGTH;
                  const visible = expanded || !long ? note : `${note.slice(0, ACT_PREVIEW_LENGTH).trimEnd()}…`;
                  return (
                    <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700" key={note}>
                      <p className="whitespace-pre-wrap">{visible}</p>
                      {long ? <button className="mt-2 text-sm font-semibold text-orange-700 hover:underline" type="button" onClick={() => toggleActNote(note)}>{expanded ? "Less" : "More"}</button> : null}
                    </li>
                  );
                })}
              </ul>
            ) : <p className="rounded-lg bg-white p-3 text-sm text-slate-600">No ACT history matches “{actHistorySearch.trim()}”.</p>}
          </div>
          </details>
        ) : null}

        </> : null}
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold text-slate-800">More profile tools</summary>
          <div className="mt-3">
            <EventProfileWorkspace
              showHeader={false}
              profile={data}
              assistedCallingEnabled={data.assistedCallingEnabled === true}
              callablePhoneByContactId={callablePhoneByContactId}
              context={{ bookingId, followUpId, action: action === "follow-up" ? undefined : action, mode }}
              familyNotes={familyNotes}
              familyNotesError={familyNotesError}
              retryFamilyNotes={retryFamilyNotes}
              organizationContext={data.organizationContext ?? { parent: null, children: [] }}
              onOrganizationChanged={() => void loadProfile()}
            />
          </div>
        </details>
    </ProfilePageFrame>
  );
}
