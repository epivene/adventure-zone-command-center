import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { apiGet } from "@/lib/auth-token";
import { CallWorkspace } from "@/components/calls/call-workspace";
import { createActivityAction, editActivityAction, listActivityRevisionsAction } from "@/actions/activities";
import { completeCallAction } from "@/actions/calls";

function toDate(value: unknown): Date | null {
  return value ? new Date(value as string) : null;
}

function coerceTimeline(items: any[]): any[] {
  return (items ?? []).map((item) => ({
    ...item,
    occurredAt: item.occurredAt ? new Date(item.occurredAt) : item.occurredAt,
    createdAt: item.createdAt ? new Date(item.createdAt) : item.createdAt,
    updatedAt: item.updatedAt ? new Date(item.updatedAt) : item.updatedAt,
  }));
}

export default function CallWorkspacePage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const followUpId = params.get("followUpId") ?? undefined;
  const bookingId = params.get("bookingId") ?? undefined;
  const contactId = params.get("contactId") ?? undefined;
  const organizationId = params.get("organizationId") ?? undefined;

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (followUpId) qs.set("followUpId", followUpId);
    if (bookingId) qs.set("bookingId", bookingId);
    if (contactId) qs.set("contactId", contactId);
    if (organizationId) qs.set("organizationId", organizationId);

    apiGet<any>(`/calls/workspace?${qs.toString()}`)
      .then((d) => { setData(d); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); });
  }, [search]);

  if (loading) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-slate-500">Loading call workspace…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-7xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const context = data.context ?? {};
  const booking = context.booking
    ? { ...context.booking, startsAt: toDate(context.booking.startsAt) }
    : null;
  const contact = context.contact
    ? {
        id: context.contact.id,
        name: context.contact.name ?? `${context.contact.firstName ?? ""} ${context.contact.lastName ?? ""}`.trim(),
        phone: context.contact.phone ?? null,
        email: context.contact.email ?? null,
        city: context.contact.city ?? null,
        region: context.contact.region ?? null,
      }
    : null;
  const followUp = context.followUp
    ? { ...context.followUp, dueAt: new Date(context.followUp.dueAt) }
    : null;

  return (
    <div className="mx-auto max-w-7xl">
      <CallWorkspace
        organization={context.organization ?? null}
        contact={contact}
        booking={booking}
        followUp={followUp}
        timeline={coerceTimeline(data.timeline)}
        activityParent={data.activityParent}
        onComplete={completeCallAction}
        createActivity={createActivityAction}
        editActivity={editActivityAction}
        loadRevisions={listActivityRevisionsAction}
        operations={data.operations ?? null}
      />
    </div>
  );
}
