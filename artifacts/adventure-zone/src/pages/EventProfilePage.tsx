import { useEffect, useState } from "react";
import { useLocation, useParams, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";
import { EventRatingSummary } from "@/components/event-profiles/event-rating-summary";
import { listFamilyNotes } from "@/actions/scoped-notes";
import type { ScopedNoteView } from "@/features/notes/scoped-note-types";

export default function EventProfilePage() {
  const { profileId } = useParams<{ profileId: string }>();
  const search = useSearch();
  const [, setLocation] = useLocation();
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
      {
        const ratingSummary = await apiGet<{ average: number | null; count: number }>(`/event-wrap-up-ratings/organization/${profileId}`).catch(() => ({ average: null, count: 0 }));
        // JSON dates arrive as strings — the workspace formats Date objects.
        const toDate = (v: any) => (v ? new Date(v) : null);
        const normalized = {
          ...d,
          wrapUpRatingSummary: ratingSummary,
          notes: (d.notes ?? []).map((n: any) => ({ ...n, occurredAt: toDate(n.occurredAt), createdAt: toDate(n.createdAt), updatedAt: toDate(n.updatedAt) })),
          followUps: (d.followUps ?? []).map((f: any) => ({
            ...f,
            dueAt: toDate(f.dueAt),
            completedAt: toDate(f.completedAt),
          })),
          bookings: (d.bookings ?? []).map((b: any) => ({ ...b, startsAt: toDate(b.startsAt) })),
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
        setLoading(false);
      }
    } catch (e: any) {
      setError(e.message);
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, [profileId, contactId]);

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

  return (
    <div className="mx-auto grid max-w-7xl gap-4">
      <button
        aria-label="Back"
        className="w-fit rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
        onClick={goBack}
        type="button"
      >
        <span aria-hidden="true">←</span> Back
      </button>
      <EventRatingSummary average={data.wrapUpRatingSummary?.average ?? null} count={data.wrapUpRatingSummary?.count ?? 0} />
      {recoveredActNotes.length ? (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm" aria-labelledby="recovered-act-history-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-xl font-bold" id="recovered-act-history-title">Recovered ACT notes &amp; history</h2>
              <p className="mt-1 text-sm text-amber-900">Preserved from merged ACT profiles. These records are read-only so the original imported history stays intact.</p>
            </div>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900">{recoveredActNotes.length} recovered</span>
          </div>
          <ul className="mt-4 grid gap-3">
            {recoveredActNotes.map((note: string) => (
              <li className="whitespace-pre-wrap rounded-lg border border-amber-200 bg-white/70 p-3 text-sm text-slate-800" key={note}>
                {note}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
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
  );
}
