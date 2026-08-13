import { useCallback, useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";

import { createActivityAction, editActivityAction, listActivityRevisionsAction } from "@/actions/activities";
import { completeCallAction } from "@/actions/calls";
import { CallWorkspace } from "@/components/calls/call-workspace";
import { CallerFinder } from "@/components/calls/caller-finder";
import { apiGet } from "@/lib/auth-token";

type MobileCallLogPageProps = {
  contactId?: string;
  organizationId?: string;
  bookingId?: string;
  followUpId?: string;
};

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

export default function MobileCallLogPage(props: MobileCallLogPageProps = {}) {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const [contactId, setContactId] = useState(props.contactId ?? params.get("contactId") ?? undefined);
  const organizationId = props.organizationId ?? params.get("organizationId") ?? undefined;
  const bookingId = props.bookingId ?? params.get("bookingId") ?? undefined;
  const followUpId = props.followUpId ?? params.get("followUpId") ?? undefined;
  const [, setLocation] = useLocation();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(Boolean(contactId));
  const [error, setError] = useState<string | null>(null);
  const selectCaller = useCallback((nextContactId: string) => {
    setContactId(nextContactId);
    const query = new URLSearchParams({ contactId: nextContactId });
    if (organizationId) query.set("organizationId", organizationId);
    if (bookingId) query.set("bookingId", bookingId);
    if (followUpId) query.set("followUpId", followUpId);
    setLocation(`/calls/log?${query.toString()}`, { replace: true });
  }, [organizationId, bookingId, followUpId, setLocation]);

  useEffect(() => {
    if (!contactId) {
      setData(null);
      setLoading(false);
      return;
    }

    const query = new URLSearchParams({ contactId });
    if (organizationId) query.set("organizationId", organizationId);
    if (bookingId) query.set("bookingId", bookingId);
    if (followUpId) query.set("followUpId", followUpId);

    setLoading(true);
    setError(null);
    apiGet<any>(`/calls/workspace?${query.toString()}`)
      .then((workspace) => {
        setData(workspace);
        setLoading(false);
      })
      .catch((reason) => {
        setError(reason.message);
        setLoading(false);
      });
  }, [contactId, organizationId, bookingId, followUpId]);

  if (!contactId) {
    return <div className="mx-auto max-w-xl"><CallerFinder onSelect={selectCaller} /></div>;
  }
  if (loading) return <div className="mx-auto max-w-xl"><p className="mt-8 text-slate-500">Loading call log…</p></div>;
  if (error || !data) return <div className="mx-auto max-w-xl"><p className="mt-8 text-rose-700">{error ?? "Not found"}</p></div>;

  const context = data.context ?? {};
  const booking = context.booking ? { ...context.booking, startsAt: toDate(context.booking.startsAt) } : null;
  const contact = context.contact ? {
    id: context.contact.id,
    name: context.contact.name ?? `${context.contact.firstName ?? ""} ${context.contact.lastName ?? ""}`.trim(),
    phone: context.contact.phone ?? null,
    email: context.contact.email ?? null,
    city: context.contact.city ?? null,
    region: context.contact.region ?? null,
  } : null;
  const followUp = context.followUp ? { ...context.followUp, dueAt: new Date(context.followUp.dueAt) } : null;

  return (
    <div className="mx-auto max-w-xl">
      <CallWorkspace
        activityParent={data.activityParent}
        assistedCallingEnabled={false}
        booking={booking}
        contact={contact}
        contextSummary={data.contextSummary ?? null}
        createActivity={createActivityAction}
        defaultScriptKind={data.defaultScriptKind}
        editActivity={editActivityAction}
        followUp={followUp}
        loadRevisions={listActivityRevisionsAction}
        mode="mobile"
        onComplete={completeCallAction}
        operations={data.operations ?? null}
        organization={context.organization ?? null}
        phones={data.phones ?? []}
        scriptPrompts={data.scriptPrompts ?? []}
        timeline={coerceTimeline(data.timeline)}
        voicemailLauncherUrl={null}
      />
    </div>
  );
}
