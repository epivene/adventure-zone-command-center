import { useEffect, useMemo, useState } from "react";

import { apiPatch, apiPost } from "@/lib/auth-token";
import type {
  DraftRewriteAction,
  OpportunityEmailDraft,
  OutreachCompletion,
} from "@/features/opportunity-email/opportunity-email-types";
import { FollowUpAfterSend } from "./follow-up-after-send";
import { OutreachDraftReviewControl, useOutreachPlannerEnabled } from "@/components/today/outreach-planner";

type Props = {
  draft: OpportunityEmailDraft;
  fromAccount: string;
  eventName?: string;
  onDraftChange?: (draft: OpportunityEmailDraft) => void;
  onOutreachComplete?: (result: OutreachCompletion) => void;
};

type RewriteResponse = {
  draft: OpportunityEmailDraft;
  undoSubject: string;
  undoBody: string;
};

type DeliveryResponse = {
  draft: OpportunityEmailDraft;
  followUpReferenceAt: string;
};

const quickActions: Array<{ label: string; action: DraftRewriteAction }> = [
  { label: "Shorter", action: "shorter" },
  { label: "More casual", action: "more_casual" },
  { label: "More direct", action: "more_direct" },
  { label: "Rewrite opening", action: "rewrite_opening" },
  { label: "More personal", action: "more_personal" },
  { label: "Stronger follow-up", action: "stronger_follow_up" },
  { label: "Fix wording", action: "fix_wording" },
];

function requestKey(kind: "send" | "schedule", draftId: string) {
  return `${kind}:${draftId}:${crypto.randomUUID()}`;
}

function stateLabel(state: OpportunityEmailDraft["state"]) {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function OpportunityDraftComposer({
  draft,
  fromAccount,
  eventName,
  onDraftChange,
  onOutreachComplete,
}: Props) {
  const [currentDraft, setCurrentDraft] = useState(draft);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [undoSnapshot, setUndoSnapshot] = useState<{ subject: string; body: string } | null>(null);
  const [scheduledFor, setScheduledFor] = useState("");
  const [followUpReferenceAt, setFollowUpReferenceAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewApproved, setReviewApproved] = useState(false);
  const outreachReviewState = useOutreachPlannerEnabled();
  const outreachReviewEnabled = outreachReviewState === true;
  const outreachReviewChecking = outreachReviewState === null;

  useEffect(() => {
    setCurrentDraft(draft);
    setSubject(draft.subject);
    setBody(draft.body);
  }, [draft.id, draft.updatedAt]);

  useEffect(() => {
    setFollowUpReferenceAt(null);
    setReviewApproved(false);
  }, [draft.id]);

  const dirty = subject !== currentDraft.subject || body !== currentDraft.body;

  const statusText = useMemo(() => {
    if (currentDraft.state === "scheduled" && currentDraft.scheduledFor) {
      return `Scheduled · ${new Date(currentDraft.scheduledFor).toLocaleString()}`;
    }
    if (currentDraft.state === "sent" && currentDraft.sentAt) {
      return `Sent · ${new Date(currentDraft.sentAt).toLocaleString()}`;
    }
    return stateLabel(currentDraft.state);
  }, [currentDraft]);

  function applyDraft(next: OpportunityEmailDraft) {
    setCurrentDraft(next);
    setSubject(next.subject);
    setBody(next.body);
    onDraftChange?.(next);
  }

  async function save() {
    setBusy("save");
    setError(null);
    try {
      const response = await apiPatch<{ draft: OpportunityEmailDraft }>(
        `/opportunities/${currentDraft.opportunityId}/draft`,
        { draftId: currentDraft.id, subject, body },
      );
      applyDraft(response.draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the draft.");
    } finally {
      setBusy(null);
    }
  }

  async function rewrite(action: DraftRewriteAction) {
    setBusy(action);
    setError(null);
    try {
      const response = await apiPost<RewriteResponse>(
        `/opportunities/${currentDraft.opportunityId}/draft/rewrite`,
        { draftId: currentDraft.id, action, subject, body },
      );
      setUndoSnapshot({ subject: response.undoSubject, body: response.undoBody });
      applyDraft(response.draft);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rewrite the draft.");
    } finally {
      setBusy(null);
    }
  }

  function undoAiChange() {
    if (!undoSnapshot) return;
    setSubject(undoSnapshot.subject);
    setBody(undoSnapshot.body);
    setUndoSnapshot(null);
  }

  async function sendNow() {
    setBusy("send");
    setError(null);
    try {
      const response = await apiPost<DeliveryResponse>(
        `/opportunities/${currentDraft.opportunityId}/draft/send`,
        { draftId: currentDraft.id, requestKey: requestKey("send", currentDraft.id) },
      );
      applyDraft(response.draft);
      setFollowUpReferenceAt(response.followUpReferenceAt);
      onOutreachComplete?.({ kind: "sent", referenceAt: response.followUpReferenceAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The email was not sent.");
    } finally {
      setBusy(null);
    }
  }

  async function schedule() {
    if (!scheduledFor) {
      setError("Choose a date and time before scheduling.");
      return;
    }
    const when = new Date(scheduledFor);
    if (!Number.isFinite(when.getTime()) || when.getTime() <= Date.now()) {
      setError("Choose a future date and time.");
      return;
    }
    setBusy("schedule");
    setError(null);
    try {
      const response = await apiPost<DeliveryResponse>(
        `/opportunities/${currentDraft.opportunityId}/draft/schedule`,
        {
          draftId: currentDraft.id,
          requestKey: requestKey("schedule", currentDraft.id),
          scheduledFor: when.toISOString(),
        },
      );
      applyDraft(response.draft);
      setFollowUpReferenceAt(response.followUpReferenceAt);
      onOutreachComplete?.({ kind: "scheduled", referenceAt: response.followUpReferenceAt });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not schedule the email.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="opportunity-email-composer-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Opportunity email</p>
          <h3 className="mt-1 text-lg font-bold" id="opportunity-email-composer-title">{eventName ? `Draft · ${eventName}` : "Email draft"}</h3>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">{statusText}</span>
      </div>

      <div className="grid gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-2">
        <div><span className="font-semibold text-slate-600">From</span><p>{fromAccount}</p></div>
        <div><span className="font-semibold text-slate-600">To</span><p>{currentDraft.recipientName ? `${currentDraft.recipientName} · ` : ""}{currentDraft.recipientEmail}</p></div>
        <div><span className="font-semibold text-slate-600">Purpose</span><p>{currentDraft.purpose.replaceAll("_", " ")}</p></div>
        <div><span className="font-semibold text-slate-600">Event year</span><p>{currentDraft.eventYear}</p></div>
      </div>

      {currentDraft.lastFailureMessage ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <strong>Needs attention:</strong> {currentDraft.lastFailureMessage}
        </div>
      ) : null}
      {error ? <p className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800" role="alert">{error}</p> : null}

      <label className="grid gap-1 text-sm font-semibold">
        Subject
        <input className="rounded-lg border border-slate-300 px-3 py-2 font-normal" value={subject} onChange={(event) => setSubject(event.target.value)} />
      </label>
      <label className="grid gap-1 text-sm font-semibold">
        Body
        <textarea className="min-h-72 rounded-lg border border-slate-300 px-3 py-2 font-normal" value={body} onChange={(event) => setBody(event.target.value)} />
      </label>

      <div className="flex flex-wrap gap-2" aria-label="Quick AI edits">
        {quickActions.map((item) => (
          <button className="button-secondary" disabled={busy !== null} key={item.action} type="button" onClick={() => void rewrite(item.action)}>{item.label}</button>
        ))}
        <button className="button-secondary" disabled={!undoSnapshot || busy !== null} type="button" onClick={undoAiChange}>Undo AI change</button>
      </div>

      <div className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="grid gap-1 text-sm font-semibold">
          Schedule date &amp; time ({Intl.DateTimeFormat().resolvedOptions().timeZone || "your device timezone"})
          <input aria-label="Schedule date and time" className="rounded-lg border border-slate-300 px-3 py-2 font-normal" type="datetime-local" value={scheduledFor} onChange={(event) => setScheduledFor(event.target.value)} />
        </label>
        <button className="button-secondary" disabled={busy !== null || outreachReviewChecking || (outreachReviewEnabled && (dirty || !reviewApproved))} title={outreachReviewEnabled ? !reviewApproved ? "Review and approve the exact final content first." : dirty ? "Save draft changes before scheduling." : undefined : undefined} type="button" onClick={() => void schedule()}>Schedule</button>
      </div>

      {outreachReviewEnabled ? <OutreachDraftReviewControl
        content={{ to: currentDraft.recipientEmail, subject: currentDraft.subject, body: currentDraft.body }}
        dirty={dirty}
        draftId={currentDraft.id}
        kind="opportunity_email"
        onApprovalChange={setReviewApproved}
      /> : null}

      <div className="flex flex-wrap justify-end gap-2">
        <button className="button-secondary" disabled={busy !== null} type="button" onClick={() => void save()}>{busy === "save" ? "Saving…" : "Save Draft"}</button>
        <button className="button-primary" disabled={busy !== null || outreachReviewChecking || (outreachReviewEnabled && (dirty || !reviewApproved))} title={outreachReviewEnabled ? !reviewApproved ? "Review and approve the exact final content first." : dirty ? "Save draft changes before sending." : undefined : undefined} type="button" onClick={() => void sendNow()}>{busy === "send" ? "Sending…" : "Send"}</button>
      </div>

      {followUpReferenceAt ? (
        <FollowUpAfterSend
          opportunityId={currentDraft.opportunityId}
          referenceAt={followUpReferenceAt}
          onDone={() => setFollowUpReferenceAt(null)}
        />
      ) : null}
    </section>
  );
}
