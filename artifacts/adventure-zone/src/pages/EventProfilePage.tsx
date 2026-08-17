import { useEffect, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import { EventRatingSummary } from "@/components/event-profiles/event-rating-summary";
import { SimpleFullProfile } from "@/components/profiles/simple-full-profile";
import { simplifyHistoryText } from "@/components/profiles/history-summary";
import { AssistantContextRegistration } from "@/components/assistant/assistant-context-registration";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { listFamilyNotes } from "@/actions/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

export default function EventProfilePage() {
  const { profileId } = useParams<{ profileId: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { openAssistant } = useAssistantContext();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [callablePhoneByContactId, setCallablePhoneByContactId] = useState<Record<string, string | null>>({});
  const [familyNotes, setFamilyNotes] = useState<ScopedNoteView[]>([]);
  const [familyNotesError, setFamilyNotesError] = useState<string | null>(null);

  const params = new URLSearchParams(search);
  const contactId = params.get("contactId") ?? undefined;
  const bookingId = params.get("bookingId") ?? undefined;
  const followUpId = params.get("followUpId") ?? undefined;
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
      const d = await apiGet<any>(`/event-profiles/${profileId}?${qs.toString()}`);
      const ratingSummary = await apiGet<{ average: number | null; count: number }>(`/event-wrap-up-ratings/organization/${profileId}`).catch(() => ({ average: null, count: 0 }));
      const toDate = (value: any) => (value ? new Date(value) : null);
      const normalized = {
        ...d,
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

  function retryFamilyNotes() {
    if (data?.familyContext?.kind !== "event_family") return;
    setFamilyNotesError(null);
    void listFamilyNotes(data.familyContext.id).then(setFamilyNotes).catch(() => setFamilyNotesError("Could not load family notes."));
  }

  function goBack() {
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
      .map((note: string) => note.trim())
      .filter(Boolean),
  )];
  const profileLabel = String(data.name ?? data.organization?.name ?? "Profile");

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      {profileId ? (
        <AssistantContextRegistration
          kind="organization"
          label={profileLabel}
          recordId={profileId}
        />
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          aria-label="Back"
          className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
          onClick={goBack}
          type="button"
        >
          <span aria-hidden="true">←</span> Back
        </button>
        <button
          className="button-secondary"
          onClick={() => openAssistant("What do I need to know before I contact them?")}
          type="button"
        >
          Ask Assistant
        </button>
      </div>

      <SimpleFullProfile profile={data} />

      {(data.wrapUpRatingSummary?.count ?? 0) > 0 ? (
        <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <summary className="cursor-pointer font-semibold text-slate-800">Reviews & rating ({data.wrapUpRatingSummary.count})</summary>
          <div className="mt-3"><EventRatingSummary average={data.wrapUpRatingSummary?.average ?? null} count={data.wrapUpRatingSummary?.count ?? 0} /></div>
        </details>
      ) : null}

      {recoveredActNotes.length ? (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <summary className="cursor-pointer font-semibold text-slate-800">Imported ACT history ({recoveredActNotes.length})</summary>
          <p className="mt-2 text-sm text-slate-600">Original imported records are preserved here for reference.</p>
          <ul className="mt-3 grid gap-2">
            {recoveredActNotes.map((note: string) => (
              <li className="rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700" key={note}>{simplifyHistoryText(note)}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <details className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <summary className="cursor-pointer font-semibold text-slate-800">Advanced profile tools</summary>
        <p className="mt-2 text-sm text-slate-600">Organization relationships, locations, calling tools, family notes, and the original detailed workspace.</p>
        <div className="mt-4">
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
