import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { completeCallAction } from "@/actions/calls";
import {
  createActivityAction,
  editActivityAction,
  listActivityRevisionsAction,
} from "@/actions/activities";
import {
  CallWorkspace,
  type CompleteCallResult,
} from "@/components/calls/call-workspace";
import { callWorkspaceHref } from "@/components/today/next-call-card";
import { apiGet } from "@/lib/auth-token";

export type CallQueueItem = {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  bookingName: string;
  contactName: string | null;
  organizationName: string | null;
  bookingStatus: string | null;
  routeLeg: { id: string; name: string; color: string } | null;
  lastContactedAt: Date | string | null;
  kind: string;
  dueAt: Date | string;
  status: string;
};

type CallingConfig = {
  assistedCallingEnabled: boolean;
  voicemailLauncherUrl: string | null;
};

type RefreshedToday = {
  followUps: CallQueueItem[];
  followUpTotal: number;
};

type LoadWorkspace = (followUp: CallQueueItem) => Promise<any>;
type CompleteCall = (input: any) => Promise<CompleteCallResult>;

type CallQueueWorkspaceProps = {
  followUps: CallQueueItem[];
  initialFollowUpId?: string;
  remainingCount?: number;
  callingConfig?: CallingConfig;
  loadWorkspace?: LoadWorkspace;
  completeCall?: CompleteCall;
  refreshToday?: () => Promise<RefreshedToday>;
  renderWorkspace?: (
    data: any,
    onComplete: CompleteCall,
    callingConfig: CallingConfig,
  ) => ReactNode;
};

const defaultCallingConfig: CallingConfig = {
  assistedCallingEnabled: true,
  voicemailLauncherUrl: null,
};

function formatStatus(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function formatDate(value: Date | string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}

function coerceTimeline(items: any[]) {
  return (items ?? []).map((item) => ({
    ...item,
    occurredAt: item.occurredAt ? new Date(item.occurredAt) : item.occurredAt,
    createdAt: item.createdAt ? new Date(item.createdAt) : item.createdAt,
    updatedAt: item.updatedAt ? new Date(item.updatedAt) : item.updatedAt,
  }));
}

function defaultRenderWorkspace(
  data: any,
  onComplete: CompleteCall,
  callingConfig: CallingConfig,
) {
  const context = data.context ?? {};
  const contact = context.contact
    ? {
        id: context.contact.id,
        name:
          context.contact.name ??
          `${context.contact.firstName ?? ""} ${context.contact.lastName ?? ""}`.trim(),
        phone: context.contact.phone ?? null,
        email: context.contact.email ?? null,
        city: context.contact.city ?? null,
        region: context.contact.region ?? null,
      }
    : null;
  const booking = context.booking
    ? {
        ...context.booking,
        startsAt: context.booking.startsAt
          ? new Date(context.booking.startsAt)
          : null,
      }
    : null;
  const followUp = context.followUp
    ? { ...context.followUp, dueAt: new Date(context.followUp.dueAt) }
    : null;

  return (
    <CallWorkspace
      activityParent={data.activityParent}
      assistedCallingEnabled={callingConfig.assistedCallingEnabled}
      booking={booking}
      contact={contact}
      contextSummary={data.contextSummary ?? null}
      createActivity={createActivityAction}
      defaultScriptKind={data.defaultScriptKind}
      editActivity={editActivityAction}
      followUp={followUp}
      loadRevisions={listActivityRevisionsAction}
      mode="compact"
      onComplete={onComplete}
      operations={data.operations ?? null}
      organization={context.organization ?? null}
      phones={data.phones ?? []}
      scriptPrompts={data.scriptPrompts ?? []}
      timeline={coerceTimeline(data.timeline)}
      voicemailLauncherUrl={callingConfig.voicemailLauncherUrl}
    />
  );
}

async function defaultLoadWorkspace(followUp: CallQueueItem) {
  return apiGet<any>(`/calls/workspace?followUpId=${encodeURIComponent(followUp.id)}`);
}

async function defaultRefreshToday() {
  return apiGet<RefreshedToday>("/today");
}

export function CallQueueWorkspace({
  followUps,
  initialFollowUpId,
  remainingCount,
  callingConfig = defaultCallingConfig,
  loadWorkspace = defaultLoadWorkspace,
  completeCall = completeCallAction,
  refreshToday = defaultRefreshToday,
  renderWorkspace = defaultRenderWorkspace,
}: CallQueueWorkspaceProps) {
  const [queue, setQueue] = useState(followUps);
  const [total, setTotal] = useState(remainingCount ?? followUps.length);
  const [selectedId, setSelectedId] = useState(
    initialFollowUpId && followUps.some(({ id }) => id === initialFollowUpId)
      ? initialFollowUpId
      : followUps[0]?.id ?? null,
  );
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const selected = queue.find(({ id }) => id === selectedId) ?? null;

  useEffect(() => {
    setQueue(followUps);
    setTotal(remainingCount ?? followUps.length);
    setSelectedId((current) =>
      current && followUps.some(({ id }) => id === current)
        ? current
        : followUps[0]?.id ?? null,
    );
  }, [followUps, remainingCount]);

  useEffect(() => {
    if (!selected) {
      setWorkspace(null);
      setLoading(false);
      setError(null);
      return;
    }

    let active = true;
    setWorkspace(null);
    setLoading(true);
    setError(null);
    loadWorkspace(selected)
      .then((data) => {
        if (active) setWorkspace({ ...data, followUpId: selected.id });
      })
      .catch(() => {
        if (active) setError("Could not load this caller.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selected?.id, retryKey, loadWorkspace]);

  async function handleComplete(input: any): Promise<CompleteCallResult> {
    if (!selected) return { ok: false, error: "No caller is selected." };
    const completedId = selected.id;
    const completedIndex = queue.findIndex(({ id }) => id === completedId);
    const originalNextId = queue[completedIndex + 1]?.id ?? null;
    const result = await completeCall(input);
    if (!result.ok) return result;

    let nextQueue = queue.filter(({ id }) => id !== completedId);
    let nextTotal = Math.max(0, total - 1);
    try {
      const refreshed = await refreshToday();
      const completedFollowUpWasStale = refreshed.followUps.some(
        ({ id }) => id === completedId,
      );
      nextQueue = refreshed.followUps.filter(({ id }) => id !== completedId);
      nextTotal = Math.max(
        0,
        refreshed.followUpTotal - (completedFollowUpWasStale ? 1 : 0),
      );
    } catch {
      // Completion already succeeded; keep the responsive local queue state.
    }

    const selectedAfterRefresh =
      (originalNextId
        ? nextQueue.find(({ id }) => id === originalNextId)
        : null) ??
      nextQueue[Math.min(completedIndex, Math.max(0, nextQueue.length - 1))] ??
      null;
    setQueue(nextQueue);
    setTotal(nextTotal);
    setSelectedId(selectedAfterRefresh?.id ?? null);
    return { ok: true };
  }

  return (
    <section
      className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(18rem,.8fr)_minmax(0,1.2fr)] lg:items-start"
      data-testid="call-queue-layout"
    >
      <div
        className="order-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm lg:order-1"
        data-testid="call-queue-panel"
      >
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">Calls to make</h2>
            <p className="mt-1 text-sm text-slate-600">Prioritized follow-ups for today.</p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">
            {total} remaining
          </span>
        </div>

        {queue.length ? (
          <ol className="mt-4 grid gap-2">
            {queue.map((followUp) => {
              const active = followUp.id === selectedId;
              const label = followUp.contactName ?? followUp.bookingName;
              return (
                <li key={followUp.id}>
                  <button
                    aria-current={active ? "true" : undefined}
                    className={`w-full rounded-lg border p-3 text-left transition ${
                      active
                        ? "border-orange-400 bg-orange-50"
                        : "border-slate-200 bg-white hover:border-orange-300"
                    }`}
                    onClick={() => setSelectedId(followUp.id)}
                    type="button"
                  >
                    <span className="block font-bold text-slate-950">{label}</span>
                    {followUp.organizationName ? (
                      <span className="mt-0.5 block text-sm text-slate-600">{followUp.organizationName}</span>
                    ) : null}
                    <span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold text-slate-600">
                      {followUp.bookingStatus ? <span>{formatStatus(followUp.bookingStatus)}</span> : null}
                      {followUp.routeLeg ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: followUp.routeLeg.color }} />
                          {followUp.routeLeg.name}
                        </span>
                      ) : null}
                      <span>
                        {followUp.lastContactedAt
                          ? `Last contacted ${formatDate(followUp.lastContactedAt)}`
                          : "Not contacted yet"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="mt-4 text-sm text-slate-600">No open calls.</p>
        )}
      </div>

      <div className="order-1 min-w-0 lg:order-2" data-testid="selected-call-workspace">
        {!selected ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Select a caller from the queue.
          </div>
        ) : loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Loading caller…
          </div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6" role="alert">
            <p className="font-semibold text-rose-900">{error}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="button-primary" onClick={() => setRetryKey((value) => value + 1)} type="button">
                Try again
              </button>
              <a className="button-secondary" href={callWorkspaceHref(selected as any)}>
                Open standalone workspace
              </a>
            </div>
          </div>
        ) : workspace ? (
          renderWorkspace(workspace, handleComplete, callingConfig)
        ) : null}
      </div>
    </section>
  );
}
