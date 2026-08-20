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
import { CallAssistantPanel } from "@/components/calls/call-assistant-panel";
import {
  CallWorkspace,
  type CompleteCallResult,
} from "@/components/calls/call-workspace";
import { callWorkspaceHref } from "@/components/today/next-call-card";
import {
  CopilotReason,
  type BookingCopilotReason,
} from "@/components/today/copilot-reason";
import { buildTelHref } from "@/features/calls/phone-launcher";
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
  callPhone?: {
    id: string;
    number: string;
    extension: string | null;
    type: string;
  } | null;
  copilot?: BookingCopilotReason | null;
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
    <div className="grid gap-3">
      <CallWorkspace
        activityParent={data.activityParent}
        assistedCallingEnabled={callingConfig.assistedCallingEnabled}
        booking={booking}
        briefing={data.briefing ?? null}
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
        recommendedGuidedScriptKind={data.recommendedGuidedScriptKind ?? null}
        scriptPrompts={data.scriptPrompts ?? []}
        timeline={coerceTimeline(data.timeline)}
        voicemailLauncherUrl={callingConfig.voicemailLauncherUrl}
      />
      <details className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <summary className="cursor-pointer text-sm font-bold text-slate-700">Assistant & Needs Answer</summary>
        <div className="mt-3">
          <CallAssistantPanel
            bookingId={context.booking?.id ?? null}
            contactId={context.contact?.id ?? null}
            followUpId={context.followUp?.id ?? null}
            organizationId={context.organization?.id ?? null}
          />
        </div>
      </details>
    </div>
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
      className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(17rem,.72fr)_minmax(0,1.28fr)] lg:items-start"
      data-testid="call-queue-layout"
    >
      <div className="order-2 rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:order-1" data-testid="call-queue-panel">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold">Calls to make</h2>
            <p className="text-xs text-slate-500">Tap a card to prep, or 📞 to start.</p>
          </div>
          <span className="whitespace-nowrap rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">{total} remaining</span>
        </div>

        {queue.length ? (
          <ol className="mt-3 grid gap-2">
            {queue.map((followUp) => {
              const active = followUp.id === selectedId;
              const label = followUp.contactName ?? followUp.bookingName;
              const telHref = followUp.callPhone?.number
                ? buildTelHref({ number: followUp.callPhone.number, extension: followUp.callPhone.extension })
                : null;
              return (
                <li className={`rounded-xl border-2 p-3 transition ${active ? "border-orange-500 bg-orange-50 shadow-sm" : "border-slate-200 bg-white hover:border-orange-300"}`} key={followUp.id}>
                  <div className="flex items-center gap-3">
                    <button aria-current={active ? "true" : undefined} className="min-w-0 flex-1 text-left" onClick={() => setSelectedId(followUp.id)} type="button">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-bold text-slate-950">{label}</span>
                        {active ? <span className="rounded-full bg-orange-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">Selected</span> : null}
                      </span>
                      {followUp.organizationName && followUp.organizationName !== label ? <span className="mt-0.5 block truncate text-xs text-slate-500">{followUp.organizationName}</span> : null}
                      <span className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-semibold text-slate-600">
                        {followUp.bookingStatus ? <span>{formatStatus(followUp.bookingStatus)}</span> : null}
                        {followUp.routeLeg ? <span>{followUp.routeLeg.name}</span> : null}
                        <span>{followUp.lastContactedAt ? `Last ${formatDate(followUp.lastContactedAt)}` : "Not contacted"}</span>
                      </span>
                    </button>
                    {telHref ? (
                      <a aria-label="Start guided call" className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-orange-600 bg-orange-600 text-xl text-white shadow-md transition hover:bg-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500" href={telHref} onClick={() => setSelectedId(followUp.id)} title={`Call ${label}`}><span aria-hidden>📞</span></a>
                    ) : (
                      <button aria-label="No callable number" className="inline-flex size-12 shrink-0 cursor-not-allowed items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-xl opacity-40" disabled type="button"><span aria-hidden>📞</span></button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : <p className="mt-4 text-sm text-slate-600">No open calls.</p>}
      </div>

      <div className="order-1 grid min-w-0 gap-3 lg:order-2" data-testid="selected-call-workspace">
        {selected ? (
          <header className="rounded-xl border border-orange-200 bg-white p-3 shadow-sm" data-testid="call-prep-header">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700">Call Prep</p>
                <p className="mt-0.5 truncate text-lg font-bold text-slate-950">{selected.contactName ?? selected.bookingName}</p>
                {selected.contactName && selected.bookingName !== selected.contactName ? <p className="truncate text-sm font-semibold text-slate-600">{selected.bookingName}</p> : null}
              </div>
              <div className="flex flex-wrap justify-end gap-1.5 text-[11px] font-bold text-slate-700">
                {selected.bookingStatus ? <span className="rounded-full bg-slate-100 px-2 py-1">{formatStatus(selected.bookingStatus)}</span> : null}
                {selected.routeLeg ? <span className="rounded-full bg-slate-100 px-2 py-1">{selected.routeLeg.name}</span> : null}
                <span className="rounded-full bg-slate-100 px-2 py-1">{selected.lastContactedAt ? `Last contact ${formatDate(selected.lastContactedAt)}` : "No prior contact"}</span>
              </div>
            </div>
            <CopilotReason copilot={selected.copilot} compact />
          </header>
        ) : null}
        {!selected ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">Select a caller from the queue.</div>
        ) : loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">Loading caller…</div>
        ) : error ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-6" role="alert">
            <p className="font-semibold text-rose-900">{error}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button className="button-primary" onClick={() => setRetryKey((value) => value + 1)} type="button">Try again</button>
              <a className="button-secondary" href={callWorkspaceHref(selected as any)}>Open standalone workspace</a>
            </div>
          </div>
        ) : workspace ? renderWorkspace(workspace, handleComplete, callingConfig) : null}
      </div>
    </section>
  );
}
