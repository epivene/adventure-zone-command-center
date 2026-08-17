import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { ResponsiveDetailSheet } from "@/components/navigation/responsive-detail-sheet";
import { ProfileActionsMenu } from "./profile-actions-menu";
import { historyCategory, simplifyHistoryText, type HistoryFilter } from "./history-summary";

export type ProfileSheetTarget = {
  profileId?: string;
  contactId?: string;
  bookingId?: string;
};

type Tab = "overview" | "notes" | "events";

function formatDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function formatDateTime(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function contactName(contact: any) {
  return contact?.name ?? ([contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || "Contact");
}

function noteLabel(note: any) {
  const category = historyCategory(note);
  if (category === "calls") return "Call";
  if (category === "follow-ups") return "Follow-up";
  if (category === "act") return "ACT note";
  return "Note";
}

const historyFilters: Array<{ value: HistoryFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "calls", label: "Calls" },
  { value: "notes", label: "Notes" },
  { value: "follow-ups", label: "Follow-ups" },
  { value: "act", label: "ACT" },
  { value: "system", label: "System" },
];

export function ProfileDetailSheet({ target, open, onOpenChange }: { target: ProfileSheetTarget | null; open: boolean; onOpenChange(open: boolean): void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const profileId = target?.profileId;

  useEffect(() => {
    if (!open || !profileId) return;
    setLoading(true);
    setError(null);
    setTab("overview");
    setHistoryFilter("all");
    const qs = new URLSearchParams();
    if (target?.contactId) qs.set("contactId", target.contactId);
    apiGet<any>(`/event-profiles/${profileId}${qs.toString() ? `?${qs.toString()}` : ""}`)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Could not load profile"))
      .finally(() => setLoading(false));
  }, [open, profileId, target?.contactId]);

  const title = useMemo(() => data?.place?.name ?? data?.organization?.name ?? data?.name ?? "Profile", [data]);
  if (!target || !profileId) return null;

  const place = data?.place ?? {};
  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
  const followUps = Array.isArray(data?.followUps) ? data.followUps : [];
  const selectedContactId = target.contactId ?? data?.selectedContactId ?? contacts[0]?.id ?? null;
  const selectedContact = contacts.find((contact: any) => contact.id === selectedContactId) ?? contacts[0] ?? null;
  const location = [place.city, place.region].filter(Boolean).join(", ");
  const meaningfulNotes = notes.filter((note: any) => historyCategory(note) !== "system");
  const filteredHistory = historyFilter === "all" ? notes : notes.filter((note: any) => historyCategory(note) === historyFilter);
  const nextFollowUp = [...followUps]
    .filter((item: any) => !item.completedAt && item.dueAt)
    .sort((a: any, b: any) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())[0] ?? null;
  const nextEvent = [...bookings]
    .filter((item: any) => item.startsAt && new Date(item.startsAt).getTime() >= Date.now())
    .sort((a: any, b: any) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] ?? null;

  return (
    <ResponsiveDetailSheet fullPageHref={`/profiles/${profileId}${selectedContactId ? `?contactId=${encodeURIComponent(selectedContactId)}` : ""}`} onOpenChange={onOpenChange} open={open} title={title}>
      {loading ? <p className="text-sm text-slate-500">Loading profile…</p> : error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : data ? (
        <div className="grid gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Profile</p>
                <h2 className="mt-1 break-words text-2xl font-bold tracking-tight text-slate-950">{place.name ?? title}</h2>
                {location ? <p className="mt-1 text-sm font-medium text-slate-600">{location}</p> : null}
                <div className="mt-2 flex flex-wrap gap-2">
                  {place.placeType ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">{String(place.placeType).replaceAll("_", " ")}</span> : null}
                  {place.lastResort ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Last Resort</span> : null}
                </div>
              </div>
              <ProfileActionsMenu profileId={profileId} contactId={selectedContactId} />
            </div>
            {selectedContact ? (
              <div className="mt-4 grid gap-1 border-t border-slate-100 pt-3 text-sm">
                <p className="font-semibold text-slate-900">{contactName(selectedContact)}{selectedContact.role ? <span className="font-normal text-slate-500"> · {selectedContact.role}</span> : null}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {selectedContact.phone ? <a className="font-medium text-orange-700" href={`tel:${selectedContact.phone}`}>{selectedContact.phone}</a> : null}
                  {selectedContact.email ? <a className="font-medium text-orange-700" href={`mailto:${selectedContact.email}`}>{selectedContact.email}</a> : null}
                </div>
              </div>
            ) : place.phone ? <a className="mt-3 block text-sm font-medium text-orange-700" href={`tel:${place.phone}`}>{place.phone}</a> : null}
          </section>

          <div role="tablist" aria-label="Profile sections" className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">
            {(["overview", "notes", "events"] as Tab[]).map((value) => (
              <button aria-selected={tab === value} className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize ${tab === value ? "bg-white text-orange-700 shadow-sm" : "text-slate-600"}`} key={value} onClick={() => setTab(value)} role="tab" type="button">{value}</button>
            ))}
          </div>

          {tab === "overview" ? (
            <div className="grid gap-3">
              <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-bold">What matters next</h3>
                {nextFollowUp ? <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next follow-up</p><p className="mt-1 font-semibold capitalize">{String(nextFollowUp.kind ?? "follow-up").replaceAll("_", " ")} · {formatDateTime(nextFollowUp.dueAt)}</p></div> : <p className="text-sm text-slate-600">No open follow-up.</p>}
                {nextEvent ? <div><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Next event</p><p className="mt-1 font-semibold">{nextEvent.name}</p><p className="text-sm text-slate-600">{formatDateTime(nextEvent.startsAt)}</p></div> : null}
              </section>
              {meaningfulNotes[0] ? <section className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Recent note</p><p className="mt-2 line-clamp-4 whitespace-pre-wrap text-sm text-slate-700">{simplifyHistoryText(meaningfulNotes[0].body ?? "")}</p></section> : null}
              <section className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold">At a glance</h3><p className="mt-2 text-sm text-slate-600">{contacts.length} contact{contacts.length === 1 ? "" : "s"} · {bookings.length} event{bookings.length === 1 ? "" : "s"} · {meaningfulNotes.length} note{meaningfulNotes.length === 1 ? "" : "s"}</p></section>
            </div>
          ) : null}

          {tab === "notes" ? (
            <section className="grid gap-3">
              <div>
                <h3 className="text-lg font-bold">Notes & communication</h3>
                <p className="mt-1 text-sm text-slate-600">Useful notes, calls, and follow-up context first.</p>
              </div>
              {meaningfulNotes.length ? meaningfulNotes.slice(0, 25).map((note: any) => (
                <article className="rounded-xl border border-slate-200 bg-white p-3" key={note.id ?? `${note.kind}-${note.occurredAt}`}>
                  <div className="flex items-baseline justify-between gap-2">
                    <h4 className="font-semibold">{noteLabel(note)}</h4>
                    {formatDate(note.occurredAt ?? note.createdAt) ? <span className="shrink-0 text-xs text-slate-500">{formatDate(note.occurredAt ?? note.createdAt)}</span> : null}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{simplifyHistoryText(note.body ?? "")}</p>
                </article>
              )) : <p className="rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600">No notes yet.</p>}

              <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <summary className="cursor-pointer font-semibold text-slate-800">History & imported changes ({notes.length})</summary>
                <div className="mt-3 grid gap-3">
                  <div className="flex flex-wrap gap-2" aria-label="History filters">
                    {historyFilters.map((filter) => (
                      <button key={filter.value} type="button" onClick={() => setHistoryFilter(filter.value)} className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${historyFilter === filter.value ? "border-orange-300 bg-orange-50 text-orange-800" : "border-slate-200 bg-white text-slate-600"}`}>{filter.label}</button>
                    ))}
                  </div>
                  {filteredHistory.length ? filteredHistory.slice(0, 60).map((note: any) => (
                    <article className="rounded-lg border border-slate-200 bg-white p-3" key={`history-${note.id ?? `${note.kind}-${note.occurredAt}`}`}>
                      <div className="flex items-baseline justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wide text-slate-500">{historyCategory(note).replaceAll("-", " ")}</span>{formatDate(note.occurredAt ?? note.createdAt) ? <span className="shrink-0 text-xs text-slate-500">{formatDate(note.occurredAt ?? note.createdAt)}</span> : null}</div>
                      <p className="mt-1 text-sm text-slate-700">{simplifyHistoryText(note.body ?? "")}</p>
                    </article>
                  )) : <p className="text-sm text-slate-600">Nothing matches this history filter.</p>}
                </div>
              </details>
            </section>
          ) : null}

          {tab === "events" ? (
            <section className="grid gap-2">
              {bookings.length ? bookings.map((booking: any) => (
                <article className="rounded-xl border border-slate-200 bg-white p-3" key={booking.id}>
                  <h3 className="font-semibold">{booking.name ?? "Event"}</h3>
                  <p className="mt-1 text-sm text-slate-600">{formatDate(booking.startsAt) ?? "Date not set"}</p>
                  <p className="mt-1 text-xs font-semibold capitalize text-slate-500">{String(booking.status ?? "").replaceAll("_", " ")}</p>
                </article>
              )) : <p className="text-sm text-slate-600">No events yet.</p>}
            </section>
          ) : null}
        </div>
      ) : null}
    </ResponsiveDetailSheet>
  );
}
