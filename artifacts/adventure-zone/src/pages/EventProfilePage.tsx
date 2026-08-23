import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { apiGet, apiPatch } from "@/lib/auth-token";
import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import { SimpleFullProfile } from "@/components/profiles/simple-full-profile";
import { ProfileDetailsCard } from "@/components/profiles/profile-details-card";
import { ProfilePrimaryActions } from "@/components/profiles/profile-primary-actions";
import { ProfileResearchPanel } from "@/components/profiles/profile-research-panel";
import { AttendanceHistoryPanel } from "@/components/profiles/attendance-history-panel";
import { ProfileSourceDocuments } from "@/components/profiles/profile-source-documents";
import { HistoricalEventDates } from "@/components/profiles/historical-event-dates";
import { simplifyHistoryText } from "@/components/profiles/history-summary";
import { PaperNoteHistorySources } from "@/components/paper-notes/paper-note-history-sources";
import { AssistantContextRegistration } from "@/components/assistant/assistant-context-registration";
import { DerivedFactsReview } from "@/components/assistant/derived-facts-review";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { extractHistoricalEventDates } from "@/features/event-profiles/historical-event-dates";
import { profileResearchGaps } from "@/features/profile-research/profile-research-gaps";
import { listFamilyNotes } from "@/actions/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

const ACT_PREVIEW_LENGTH = 280;

export default function EventProfilePage() {
  const { profileId } = useParams<{ profileId: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { openAssistant } = useAssistantContext();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profileImageDataUrl, setProfileImageDataUrl] = useState<string | null>(null);
  const [profileEditing, setProfileEditing] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);
  const [actHistorySearch, setActHistorySearch] = useState("");
  const [expandedActNotes, setExpandedActNotes] = useState<Set<string>>(() => new Set());
  const [callablePhoneByContactId, setCallablePhoneByContactId] = useState<Record<string, string | null>>({});
  const [familyNotes, setFamilyNotes] = useState<ScopedNoteView[]>([]);
  const [familyNotesError, setFamilyNotesError] = useState<string | null>(null);

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

  async function loadProfile() {
    if (!profileId) return;
    const qs = new URLSearchParams();
    if (contactId) qs.set("contactId", contactId);
    try {
      const [d, ratingSummary, photo, descriptionResult] = await Promise.all([
        apiGet<any>(`/event-profiles/${profileId}?${qs.toString()}`),
        apiGet<{ average: number | null; count: number }>(`/event-wrap-up-ratings/organization/${profileId}`).catch(() => ({ average: null, count: 0 })),
        apiGet<{ dataUrl: string | null }>(`/event-profiles/${profileId}/photo`).catch(() => ({ dataUrl: null })),
        apiGet<{ description: string | null }>(`/event-profiles/${profileId}/description`).catch(() => ({ description: null })),
      ]);
      const toDate = (value: any) => (value ? new Date(value) : null);
      const normalized = {
        ...d,
        place: {
          ...(d.place ?? {}),
          description: descriptionResult.description ?? null,
        },
        wrapUpRatingSummary: ratingSummary,
        notes: (d.notes ?? []).map((note: any) => ({
          ...note,
          body: note.importedFromAct ? simplifyHistoryText(String(note.body ?? "")) : note.body,
          occurredAt: toDate(note.occurredAt),
          createdAt: toDate(note.createdAt),
          updatedAt: toDate(note.updatedAt),
        })),
        followUps: (d.followUps ?? []).map((followUp: any) => ({ ...followUp, dueAt: toDate(followUp.dueAt), completedAt: toDate(followUp.completedAt) })),
        bookings: (d.bookings ?? []).map((booking: any) => ({ ...booking, startsAt: toDate(booking.startsAt), endsAt: toDate(booking.endsAt) })),
      };

      const callablePhones = await Promise.all((normalized.contacts ?? []).map(async (contact: any) => {
        const detail = await apiGet<any>(`/contacts/${contact.id}`).catch(() => null);
        if (!detail) return [contact.id as string, null] as const;
        const phones = Array.isArray(detail?.phones) ? detail.phones : [];
        const callablePhone = phones
          .filter((phone: any) => !phone.doNotCallAt && typeof phone.number === "string" && phone.number.trim())
          .toSorted((left: any, right: any) => Number(Boolean(right.primary)) - Number(Boolean(left.primary)))[0];
        return [contact.id as string, callablePhone?.number ?? null] as const;
      }));

      setProfileImageDataUrl(photo.dataUrl ?? null);
      setCallablePhoneByContactId(Object.fromEntries(callablePhones));
      setFamilyNotes([]);
      setFamilyNotesError(null);
      if (normalized.familyContext?.kind === "event_family") {
        listFamilyNotes(normalized.familyContext.id).then(setFamilyNotes).catch(() => setFamilyNotesError("Could not load family notes."));
      }
      setData(normalized);
      setError(null);
    } catch (reason: any) {
      setError(reason.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadProfile(); }, [profileId, contactId]);
  useEffect(() => {
    if (researchRequested && data && !profileEditing) setResearchOpen(true);
  }, [researchRequested, Boolean(data), profileEditing]);

  async function saveProfileImage(dataUrl: string | null) {
    if (!profileId) return;
    const result = await apiPatch<{ ok: boolean; dataUrl: string | null }>(`/event-profiles/${profileId}/photo`, { dataUrl });
    setProfileImageDataUrl(result.dataUrl ?? null);
  }

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
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    setLocation("/profiles");
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
  const researchGaps = profileResearchGaps(data);
  const primaryContact = (data.contacts ?? []).find((contact: any) => contact.isPrimary) ?? data.contacts?.[0] ?? null;
  const actionContactId = contactId ?? data.selectedContactId ?? primaryContact?.id ?? null;
  const actionPhone = actionContactId ? callablePhoneByContactId[actionContactId] ?? null : null;

  function toggleActNote(note: string) {
    setExpandedActNotes((current) => {
      const next = new Set(current);
      if (next.has(note)) next.delete(note);
      else next.add(note);
      return next;
    });
  }

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      {profileId ? <AssistantContextRegistration kind="organization" label={profileLabel} recordId={profileId} /> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          aria-label="Back"
          className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          onClick={goBack}
          type="button"
        >
          <span aria-hidden="true">←</span> {profileEditing ? "Back to profile" : "Back"}
        </button>
        {!profileEditing && profileId ? (
          <button className="button-secondary" type="button" onClick={() => setResearchOpen(true)}>
            Research profile{researchGaps.length ? ` · ${researchGaps.length} gaps` : ""}
          </button>
        ) : null}
      </div>

      {!profileEditing && profileId ? (
        <ProfilePrimaryActions
          profileId={profileId}
          selectedContactId={actionContactId}
          bookingId={bookingId}
          followUpId={followUpId}
          mode={mode}
          assistedCallingEnabled={data.assistedCallingEnabled === true}
          callablePhone={actionPhone}
          onEdit={() => setProfileEditing(true)}
        />
      ) : null}

      <div className={profileEditing ? "" : "[&>div>section:last-child]:hidden"}>
        <SimpleFullProfile
          profile={data}
          onProfileSaved={loadProfile}
          ratingSummary={data.wrapUpRatingSummary ?? { average: null, count: 0 }}
          onAskAssistant={() => openAssistant("What do I need to know before I contact them?")}
          profileImageDataUrl={profileImageDataUrl}
          onProfileImageChange={saveProfileImage}
          editing={profileEditing}
          onEditingChange={setProfileEditing}
        />
      </div>

      {!profileEditing ? <ProfileDetailsCard profile={data} /> : null}

      {!profileEditing && profileId ? <AttendanceHistoryPanel mode="owner" profileId={profileId} /> : null}
      {!profileEditing && profileId ? <ProfileSourceDocuments mode="owner" profileId={profileId} /> : null}

      {researchOpen && profileId ? <ProfileResearchPanel profileId={profileId} contactId={contactId ?? data.selectedContactId ?? null} onClose={() => setResearchOpen(false)} onApplied={loadProfile} /> : null}

      {!profileEditing && profileId ? <DerivedFactsReview organizationId={profileId} /> : null}

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

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" open={action === "follow-up"}>
        <summary className="cursor-pointer font-semibold text-slate-800">More profile tools</summary>
        <div className="mt-3 [&>div>header:first-child]:hidden">
          <EventProfileWorkspace
            profile={data}
            assistedCallingEnabled={data.assistedCallingEnabled === true}
            callablePhoneByContactId={callablePhoneByContactId}
            context={{ bookingId, followUpId, action, mode }}
            familyNotes={familyNotes}
            familyNotesError={familyNotesError}
            retryFamilyNotes={retryFamilyNotes}
            organizationContext={data.organizationContext ?? { parent: null, children: [] }}
            onOrganizationChanged={() => void loadProfile()}
          />
        </div>
      </details>
    </div>
  );
}
