import { useEffect, useState } from "react";
import { useParams, useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { EventProfileWorkspace } from "@/components/event-profiles/event-profile-workspace";

export default function EventProfilePage() {
  const { profileId } = useParams<{ profileId: string }>();
  const search = useSearch();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [suppressedContactIds, setSuppressedContactIds] = useState<string[]>([]);

  const params = new URLSearchParams(search);
  const contactId = params.get("contactId") ?? undefined;
  const bookingId = params.get("bookingId") ?? undefined;
  const followUpId = params.get("followUpId") ?? undefined;
  const requestedAction = params.get("action");
  const action = requestedAction === "call" || requestedAction === "follow-up"
    ? (requestedAction as "call" | "follow-up")
    : undefined;
  const mode = params.get("mode") === "prospect" ? "prospect" as const : undefined;

  useEffect(() => {
    if (!profileId) return;
    const qs = new URLSearchParams();
    if (contactId) qs.set("contactId", contactId);
    apiGet<any>(`/event-profiles/${profileId}?${qs.toString()}`)
      .then(async (d) => {
        // JSON dates arrive as strings — the workspace formats Date objects.
        const toDate = (v: any) => (v ? new Date(v) : null);
        const normalized = {
          ...d,
          notes: (d.notes ?? []).map((n: any) => ({ ...n, occurredAt: toDate(n.occurredAt) })),
          followUps: (d.followUps ?? []).map((f: any) => ({
            ...f,
            dueAt: toDate(f.dueAt),
            completedAt: toDate(f.completedAt),
          })),
          bookings: (d.bookings ?? []).map((b: any) => ({ ...b, startsAt: toDate(b.startsAt) })),
        };
        const suppression = await Promise.all((normalized.contacts ?? []).map(async (contact: any) => {
          const detail = await apiGet<any>(`/contacts/${contact.id}`).catch(() => null);
          const phones = Array.isArray(detail?.phones) ? detail.phones : [];
          return phones.length > 0 && phones.every((phone: any) => Boolean(phone.doNotCallAt))
            ? contact.id as string
            : null;
        }));
        setSuppressedContactIds(suppression.filter((id): id is string => Boolean(id)));
        setData(normalized);
        setLoading(false);
      })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [profileId, contactId]);

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Loading profile…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  return (
    <div className="mx-auto max-w-7xl">
      <EventProfileWorkspace
        profile={data}
        suppressedContactIds={suppressedContactIds}
        context={{ bookingId, followUpId, action, mode }}
      />
    </div>
  );
}
