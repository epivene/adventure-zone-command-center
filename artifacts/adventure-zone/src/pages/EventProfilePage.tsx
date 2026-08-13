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
  const [callablePhoneByContactId, setCallablePhoneByContactId] = useState<Record<string, string | null>>({});

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
        callablePhoneByContactId={callablePhoneByContactId}
        context={{ bookingId, followUpId, action, mode }}
      />
    </div>
  );
}
