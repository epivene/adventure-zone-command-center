/**
 * Campaign action buttons: send-now (with guard), test-send, schedule,
 * return-for-changes. Each is isolated so state doesn't bleed across campaigns.
 */
import { useState } from "react";
import { Clock, Loader2, Send } from "lucide-react";

import { apiPost } from "@/lib/auth-token";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";

import { formatDateTime, type CampaignCore, type CampaignSummary, type NoticeDispatch } from "./types";

// ─── SendNowButton ────────────────────────────────────────────────────────────

export function SendNowButton({
  campaignId,
  recipientCount,
  acting,
  setActing,
  onUpdated,
  onRefresh,
  setNotice,
}: {
  campaignId: string;
  recipientCount: number;
  acting: string | null;
  setActing: (a: string | null) => void;
  onUpdated: (c: CampaignCore) => void;
  onRefresh: () => void;
  setNotice: NoticeDispatch;
}) {
  const [confirming, setConfirming] = useState(false);

  async function doSend() {
    setConfirming(false);
    setActing("send-now");
    try {
      const data = await apiPost<{ campaign?: CampaignCore; state?: string }>(
        `/marketing/campaigns/${campaignId}/send-now`,
        {},
      );
      if (data.campaign) onUpdated(data.campaign);
      else onRefresh();
      setNotice({ kind: "ok", text: "Send initiated." });
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Send failed.",
      });
    } finally {
      setActing(null);
    }
  }

  return (
    <>
      <button
        className="button-primary"
        style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
        disabled={acting !== null}
        onClick={() => setConfirming(true)}
        data-testid={`campaign-send-now-${campaignId}`}
      >
        <Send className="h-3 w-3" />
        Send Now
      </button>
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm real audience send</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will send to{" "}
            <span className="font-semibold text-foreground">
              {recipientCount} confirmed recipient{recipientCount !== 1 ? "s" : ""}
            </span>
            . This action cannot be undone.
          </p>
          <div className="flex gap-2 pt-2">
            <button
              className="button-primary flex-1"
              onClick={() => void doSend()}
              data-testid="send-confirm-btn"
            >
              Confirm Send
            </button>
            <button
              className="button-secondary flex-1"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── TestSendButton ───────────────────────────────────────────────────────────

export function TestSendButton({
  campaignId,
  acting,
  setActing,
  setNotice,
}: {
  campaignId: string;
  acting: string | null;
  setActing: (a: string | null) => void;
  setNotice: NoticeDispatch;
}) {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [sending, setSending] = useState(false);

  async function doTestSend() {
    if (!address.trim()) return;
    setSending(true);
    try {
      await apiPost(`/marketing/campaigns/${campaignId}/send-test`, {
        address: address.trim(),
      });
      setNotice({ kind: "ok", text: `Test email sent to ${address.trim()}.` });
      setOpen(false);
      setAddress("");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Test send failed.",
      });
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        className="button-secondary"
        style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
        disabled={acting !== null}
        onClick={() => setOpen(true)}
        data-testid={`campaign-test-send-${campaignId}`}
      >
        Test Send
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test send (isolated)</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Sends a rendered copy to a single test address only. This does not affect the
            real audience or campaign state.
          </p>
          <label className="grid gap-1 text-sm font-semibold">
            Test address
            <input
              type="email"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="you@example.com"
              data-testid="test-send-address-input"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              className="button-primary flex-1"
              disabled={!address.trim() || sending}
              onClick={() => void doTestSend()}
              data-testid="test-send-confirm-btn"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Send Test
            </button>
            <button className="button-secondary flex-1" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── ScheduleButton ───────────────────────────────────────────────────────────

export function ScheduleButton({
  campaignId,
  acting,
  setActing,
  onUpdated,
  setNotice,
}: {
  campaignId: string;
  acting: string | null;
  setActing: (a: string | null) => void;
  onUpdated: (c: CampaignCore) => void;
  setNotice: NoticeDispatch;
}) {
  const [open, setOpen] = useState(false);
  const [scheduledFor, setScheduledFor] = useState("");
  const [scheduling, setScheduling] = useState(false);

  async function doSchedule() {
    if (!scheduledFor) return;
    setScheduling(true);
    try {
      const data = await apiPost<{ campaign: CampaignCore }>(
        `/marketing/campaigns/${campaignId}/schedule`,
        { scheduledFor },
      );
      onUpdated(data.campaign);
      setNotice({
        kind: "ok",
        text: `Campaign scheduled for ${formatDateTime(scheduledFor)}.`,
      });
      setOpen(false);
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not schedule.",
      });
    } finally {
      setScheduling(false);
      setActing(null);
    }
  }

  return (
    <>
      <button
        className="button-secondary"
        style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
        disabled={acting !== null}
        onClick={() => setOpen(true)}
        data-testid={`campaign-schedule-${campaignId}`}
      >
        <Clock className="h-3 w-3" />
        Schedule
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Schedule campaign</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Choose a future date and time. The campaign must be approved before scheduling.
          </p>
          <label className="grid gap-1 text-sm font-semibold">
            Send at
            <input
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)}
              data-testid="schedule-datetime-input"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              className="button-primary flex-1"
              disabled={!scheduledFor || scheduling}
              onClick={() => void doSchedule()}
              data-testid="schedule-confirm-btn"
            >
              {scheduling ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Clock className="h-4 w-4" />
              )}
              Schedule
            </button>
            <button className="button-secondary flex-1" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── ReturnForChangesButton ───────────────────────────────────────────────────

export function ReturnForChangesButton({
  campaignId,
  acting,
  setActing,
  onUpdated,
  setNotice,
}: {
  campaignId: string;
  acting: string | null;
  setActing: (a: string | null) => void;
  onUpdated: (c: CampaignCore) => void;
  setNotice: NoticeDispatch;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [returning, setReturning] = useState(false);

  async function doReturn() {
    if (!note.trim()) return;
    setReturning(true);
    try {
      const data = await apiPost<{ campaign: CampaignCore }>(
        `/marketing/campaigns/${campaignId}/return-for-changes`,
        { note: note.trim() },
      );
      onUpdated(data.campaign);
      setNotice({ kind: "ok", text: "Returned for changes." });
      setOpen(false);
      setNote("");
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Could not return.",
      });
    } finally {
      setReturning(false);
      setActing(null);
    }
  }

  return (
    <>
      <button
        className="button-secondary"
        style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
        disabled={acting !== null}
        onClick={() => setOpen(true)}
        data-testid={`campaign-return-${campaignId}`}
      >
        Return for Changes
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Return for changes</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Explain what needs to change before this campaign can be approved.
          </p>
          <label className="grid gap-1 text-sm font-semibold">
            Note
            <textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Describe what needs to change…"
              data-testid="return-note-input"
            />
          </label>
          <div className="flex gap-2 pt-1">
            <button
              className="button-primary flex-1"
              disabled={!note.trim() || returning}
              onClick={() => void doReturn()}
              data-testid="return-confirm-btn"
            >
              {returning ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Return for Changes
            </button>
            <button className="button-secondary flex-1" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
