import {
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { completeCallAction } from "@/actions/calls";
import { editFollowUpAction } from "@/actions/follow-ups";
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

function TaskMeta({ followUp }: { followUp: CallQueueItem }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
      {followUp.bookingStatus ? <span className="rounded-full bg-slate-100 px-2 py-1">{formatStatus(followUp.bookingStatus)}</span> : null}
      {followUp.routeLeg ? <span className="rounded-full bg-slate-100 px-2 py-1">{followUp.routeLeg.name}</span> : null}
      <span className="rounded-full bg-slate-100 px-2 py-1">
        {followUp.lastContactedAt ? `Last contact ${formatDate(followUp.lastContactedAt)}` : "No prior contact"}
      </span>
    </div>
  );
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
  const [focused, setFocused] = useState(() =>
    typeof window !== "undefined" && window.location.hash === "#today-next-task",
  );
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [queueActionBusy, setQueueActionBusy] = useState(false);
  const [queueActionError, setQueueActionError] = useState<string | null>(null);

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
    function syncFocusFromHash() {
      if (window.location.hash === "#today-next-task") setFocused(true);
    }
    syncFocusFromHash();
    window.addEventListener("hashchange", syncFocusFromHash);
    return () => window.removeEventListener("hashchange", syncFocusFromHash);
  }, []);

  useEffect(() => {
    if (!selected || !focused) {
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
  }, [selected?.id, focused, retryKey, loadWorkspace]);

  function removeFromLocalQueue(followUpId: string) {
    const removedIndex = queue.findIndex(({ id }) => id === followUpId);
    const nextQueue = queue.filter(({ id }) => id !== followUpId);
    const nextSelected = nextQueue[Math.min(Math.max(removedIndex, 0), Math.max(0, nextQueue.length - 1))] ?? null;
    setQueue(nextQueue);
    setTotal((current) => Math.max(0, current - 1));
    setSelectedId(nextSelected?.id ?? null);
    setQueueActionError(null);
  }

  function handleSkip() {
    if (!selected || queueActionBusy) return;
    removeFromLocalQueue(selected.id);
  }

  async function handleDismiss() {
    if (!selected || queueActionBusy) return;
    setQueueActionBusy(true);
    setQueueActionError(null);
    try {
      const result = await editFollowUpAction({
        followUpId: selected.id,
        kind: selected.kind,
        dueAt: selected.dueAt,
        completed: true,
        outcome: "Dismissed",
      });
      if (!result.ok) {
        setQueueActionError(result.error ?? "Could not dismiss this follow-up.");
        return;
      }
      removeFromLocalQueue(selected.id);
    } catch {
      setQueueActionError("Could not dismiss this follow-up. Please try again.");
    } finally {
      setQueueActionBusy(false);
    }
  }

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

  function leaveFocus() {
    setFocused(false);
    if (typeof window !== "undefined" && window.location.hash === "#today-next-task") {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }
  }

  if (!focused) {
    if (!selected) {
      return (
        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" id="today-next-task">
          <p className="font-bold text-slate-950">Calls complete</p>
          <p className="mt-1 text-sm text-slate-600">No open calls are waiting on you.</p>
        </section>
      );
    }

    const label = selected.contactName ?? selected.bookingName;
    return (
      <section
        className="rounded-xl border border-orange-200 bg-white p-4 shadow-sm"
        data-testid="today-next-task"
        id="today-next-task"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-orange-700">Next up</p>
          <span className="whitespace-nowrap text-xs font-bold text-slate-500">
            {total} task{total === 1 ? "" : "s"} remaining
          </span>
        </div>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-slate-950">{label}</h3>
            {selected.organizationName && selected.organizationName !== label ? (
              <p className="mt-0.5 text-sm font-medium text-slate-600">{selected.organizationName}</p>
            ) : null}
            <TaskMeta followUp={selected} />
            <CopilotReason copilot={selected.copilot} compact />
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={queueActionBusy}
                onClick={handleSkip}
                type="button"
              >
                Skip for now
              </button>
              <button
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                disabled={queueActionBusy}
                onClick={() => void handleDismiss()}
                type="button"
              >
                {queueActionBusy ? "Dismissing…" : "Dismiss"}
              </button>
            </div>
            {queueActionError ? <p className="mt-2 text-sm font-medium text-rose-700" role="alert">{queueActionError}</p> : null}
          </div>
          <button
            className="shrink-0 rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-orange-700"
            onClick={() => setFocused(true)}
            type="button"
          >
            Start
          </button>
        </div>
      </section>
    );
  }

  if (!selected) {
    return (
      <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm" id="today-next-task">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-700">Done</p>
        <h3 className="mt-1 text-xl font-bold text-emerald-950">Calls complete</h3>
        <p className="mt-1 text-sm text-emerald-800">You finished the open call queue.</p>
        <button className="mt-4 text-sm font-bold text-emerald-900 underline" onClick={leaveFocus} type="button">Back to Today</button>
      </section>
    );
  }

  return (
    <section className="grid gap-3" data-testid="call-queue-layout" id="today-next-task">
      <div className="sticky top-16 z-10 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <button className="text-sm font-bold text-orange-700 hover:underline" onClick={leaveFocus} type="button">← Back to Today</button>
          <span className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-bold text-orange-800">{total} remaining</span>
        </div>
      </div>

      <div className="grid min-w-0 gap-3" data-testid="selected-call-workspace">
        <header className="rounded-xl border border-orange-200 bg-white p-3 shadow-sm" data-testid="call-prep-header">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-orange-700">Call prep</p>
              <p className="mt-0.5 text-lg font-bold text-slate-950">{selected.contactName ?? selected.bookingName}</p>
              {selected.contactName && selected.bookingName !== selected.contactName ? (
                <p className="text-sm font-semibold text-slate-600">{selected.bookingName}</p>
              ) : null}
            </div>
            <TaskMeta followUp={selected} />
          </div>
          <CopilotReason copilot={selected.copilot} compact />
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="button-secondary" disabled={queueActionBusy} onClick={handleSkip} type="button">Skip for now</button>
            <button className="button-secondary" disabled={queueActionBusy} onClick={() => void handleDismiss()} type="button">{queueActionBusy ? "Dismissing…" : "Dismiss"}</button>
          </div>
          {queueActionError ? <p className="mt-2 text-sm font-medium text-rose-700" role="alert">{queueActionError}</p> : null}
        </header>

        {loading ? (
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