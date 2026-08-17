import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/auth-token";
import { ResponsiveDetailSheet } from "@/components/navigation/responsive-detail-sheet";
import { ProfileActionsMenu } from "./profile-actions-menu";

export type ProfileSheetTarget = {
  profileId?: string;
  contactId?: string;
  bookingId?: string;
};

type Tab = "overview" | "history" | "events";

function formatDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString();
}

function contactName(contact: any) {
  return contact?.name ?? ([contact?.firstName, contact?.lastName].filter(Boolean).join(" ") || "Contact");
}

export function ProfileDetailSheet({ target, open, onOpenChange }: { target: ProfileSheetTarget | null; open: boolean; onOpenChange(open: boolean): void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const profileId = target?.profileId;

  useEffect(() => {
    if (!open || !profileId) return;
    setLoading(true); setError(null); setTab("overview");
    const qs = new URLSearchParams();
    if (target?.contactId) qs.set("contactId", target.contactId);
    apiGet<any>(`/event-profiles/${profileId}${qs.toString() ? `?${qs.toString()}` : ""}`)
      .then(setData)
      .catch((e) => setError(e?.message ?? "Could not load profile"))
      .finally(() => setLoading(false));
  }, [open, profileId, target?.contactId]);

  const title = useMemo(() => data?.organization?.name ?? data?.name ?? data?.profile?.name ?? "Profile", [data]);
  if (!target || !profileId) return null;

  const contacts = Array.isArray(data?.contacts) ? data.contacts : [];
  const notes = Array.isArray(data?.notes) ? data.notes : [];
  const bookings = Array.isArray(data?.bookings) ? data.bookings : [];
  const selectedContactId = target.contactId ?? contacts[0]?.id ?? null;

  return (
    <ResponsiveDetailSheet fullPageHref={`/profiles/${profileId}${selectedContactId ? `?contactId=${encodeURIComponent(selectedContactId)}` : ""}`} onOpenChange={onOpenChange} open={open} title={title}>
      {loading ? <p className="text-sm text-slate-500">Loading profile…</p> : error ? <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p> : data ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {data?.organization?.status || data?.status ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{String(data?.organization?.status ?? data?.status).replaceAll("_", " ")}</span> : null}
              {data?.organization?.lastResort || data?.lastResort ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-800">Last Resort</span> : null}
            </div>
            <ProfileActionsMenu profileId={profileId} contactId={selectedContactId} />
          </div>

          <div role="tablist" aria-label="Profile sections" className="grid grid-cols-3 rounded-xl bg-slate-100 p-1">
            {(["overview", "history", "events"] as Tab[]).map((value) => <button aria-selected={tab === value} className={`rounded-lg px-3 py-2 text-sm font-semibold capitalize ${tab === value ? "bg-white text-orange-700 shadow-sm" : "text-slate-600"}`} key={value} onClick={() => setTab(value)} role="tab" type="button">{value}</button>)}
          </div>

          {tab === "overview" ? <div className="grid gap-3">
            <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">Contact</h3>{contacts.length ? contacts.map((contact: any) => <div className="mt-3 border-t border-slate-100 pt-3 first:mt-2 first:border-0 first:pt-0" key={contact.id}><p className="font-semibold">{contactName(contact)}</p>{contact.email ? <a className="mt-1 block text-sm text-orange-700" href={`mailto:${contact.email}`}>{contact.email}</a> : null}{contact.phone ? <a className="block text-sm text-orange-700" href={`tel:${contact.phone}`}>{contact.phone}</a> : null}</div>) : <p className="mt-2 text-sm text-slate-600">No contacts saved.</p>}</section>
            <section className="rounded-xl border border-slate-200 p-4"><h3 className="font-bold">At a glance</h3><p className="mt-2 text-sm text-slate-600">{bookings.length} event{bookings.length === 1 ? "" : "s"} · {notes.length} history item{notes.length === 1 ? "" : "s"}</p></section>
          </div> : null}

          {tab === "history" ? <section className="grid gap-2">{notes.length ? notes.slice(0, 30).map((note: any) => <article className="rounded-xl border border-slate-200 p-3" key={note.id ?? `${note.subject}-${note.occurredAt}`}><div className="flex items-baseline justify-between gap-2"><h3 className="font-semibold">{note.subject ?? note.type ?? "History"}</h3>{formatDate(note.occurredAt ?? note.createdAt) ? <span className="text-xs text-slate-500">{formatDate(note.occurredAt ?? note.createdAt)}</span> : null}</div><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{note.body ?? note.note ?? note.text ?? ""}</p></article>) : <p className="text-sm text-slate-600">No history yet.</p>}</section> : null}

          {tab === "events" ? <section className="grid gap-2">{bookings.length ? bookings.map((booking: any) => <article className="rounded-xl border border-slate-200 p-3" key={booking.id}><h3 className="font-semibold">{booking.name ?? booking.eventName ?? "Event"}</h3><p className="mt-1 text-sm text-slate-600">{formatDate(booking.startsAt) ?? "Date not set"}</p></article>) : <p className="text-sm text-slate-600">No events yet.</p>}</section> : null}
        </div>
      ) : null}
    </ResponsiveDetailSheet>
  );
}
