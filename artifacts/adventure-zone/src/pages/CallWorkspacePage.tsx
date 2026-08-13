import { useEffect, useState } from "react";
import { useSearch } from "wouter";

import { createActivityAction, editActivityAction, listActivityRevisionsAction } from "@/actions/activities";
import { completeCallAction } from "@/actions/calls";
import { CallWorkspace } from "@/components/calls/call-workspace";
import { apiGet } from "@/lib/auth-token";

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

type CallingConfig = {
  assistedCallingEnabled: boolean;
  voicemailLauncherUrl: string | null;
};

export default function CallWorkspacePage() {
  const search = useSearch();
  const params = new URLSearchParams(search);
  const followUpId = params.get("followUpId") ?? undefined;
  const bookingId = params.get("bookingId") ?? undefined;
  const contactId = params.get("contactId") ?? undefined;
  const organizationId = params.get("organizationId") ?? undefined;

  const [data, setData] = useState<any>(null);
  const [config, setConfig] = useState<CallingConfig>({
    assistedCallingEnabled: false,
    voicemailLauncherUrl: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams();
    if (followUpId) query.set("followUpId", followUpId);
    if (bookingId) query.set("bookingId", bookingId);
    if (contactId) query.set("contactId", contactId);
    if (organizationId) query.set("organizationId", organizationId);

    setLoading(true);
    setError(null);
    Promise.all([
      apiGet<any>(`/calls/workspace?${query.toString()}`),
      apiGet<CallingConfig>("/calls/config"),
    ])
      .then(([workspace, callingConfig]) => {
        setData(workspace);
        setConfig(callingConfig);
        setLoading(false);
      })
      .catch((reason) => {
        setError(reason.message);
        setLoading(false);
      });
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
        activityParent={data.activityParent}
        assistedCallingEnabled={config.assistedCallingEnabled}
        booking={booking}
        contact={contact}
        contextSummary={data.contextSummary ?? null}
        createActivity={createActivityAction}
        defaultScriptKind={data.defaultScriptKind}
        editActivity={editActivityAction}
        followUp={followUp}
        loadRevisions={listActivityRevisionsAction}
        mode="full"
        onComplete={completeCallAction}
        operations={data.operations ?? null}
        organization={context.organization ?? null}
        phones={data.phones ?? []}
        scriptPrompts={data.scriptPrompts ?? []}
        timeline={coerceTimeline(data.timeline)}
        voicemailLauncherUrl={config.voicemailLauncherUrl}
      />
    </div>
  );
}
