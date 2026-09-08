import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  XCircle,
} from "lucide-react";

import { apiGet, apiPost } from "@/lib/auth-token";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/avz-crm/components/ui/empty";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";

import {
  ReturnForChangesButton,
  ScheduleButton,
  SendNowButton,
  TestSendButton,
} from "./CampaignActions";
import {
  exclusionReasonLabel,
  formatDateTime,
  stateBadgeVariant,
  STATE_LABELS,
  type CampaignCore,
  type CampaignDetail,
  type CampaignSummary,
  type NoticeDispatch,
} from "./types";

// ─── Error state ──────────────────────────────────────────────────────────────

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
      <p className="font-semibold text-destructive">{message}</p>
      <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center">
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Campaign detail dialog ───────────────────────────────────────────────────

function CampaignDetailDialog({
  campaignId,
  onClose,
}: {
  campaignId: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<CampaignDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<CampaignDetail>(`/marketing/campaigns/${campaignId}`)
      .then((data) => {
        if (!cancelled) { setDetail(data); setLoading(false); }
      })
      .catch(() => {
        if (!cancelled) { setError("Could not load campaign detail."); setLoading(false); }
      });
    return () => { cancelled = true; };
  }, [campaignId]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl overflow-y-auto" style={{ maxHeight: "90vh" }}>
        <DialogHeader>
          <DialogTitle>{detail?.campaign.name ?? "Campaign Detail"}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="grid gap-2">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : detail ? (
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-muted/20 p-3">
              <Stat label="Recipients" value={detail.counts.recipients} />
              <Stat label="Sent" value={detail.counts.sent} />
              <Stat label="Failed" value={detail.counts.failed} />
            </div>

            {(detail.exclusions as any[]).length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  Excluded at snapshot ({(detail.exclusions as any[]).length})
                </p>
                <div className="grid max-h-32 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  {(detail.exclusions as any[]).map((ex: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-xs">
                      <XCircle className="h-3 w-3 shrink-0 text-destructive" />
                      <span className="font-medium">{String(ex.email ?? ex.contactId ?? "")}</span>
                      <span className="ml-auto text-muted-foreground">
                        {exclusionReasonLabel(String(ex.reason ?? ""))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.recipients.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">
                  Snapshot recipients ({detail.recipients.length})
                </p>
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  {detail.recipients.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-xs">
                      <span className="font-medium">{r.organizationName}</span>
                      <span className="text-muted-foreground">{r.contactName}</span>
                      <span className="ml-auto text-muted-foreground">{r.recipientEmail}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.events.length > 0 ? (
              <div>
                <p className="mb-1 text-xs font-semibold text-muted-foreground">Activity log</p>
                <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  {detail.events.map((ev) => (
                    <div key={ev.id} className="flex items-center gap-2 text-xs">
                      <span className="font-medium">{ev.eventType.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">by {ev.actorId}</span>
                      <span className="ml-auto text-muted-foreground">
                        {formatDateTime(ev.createdAt)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <button className="button-secondary w-full" onClick={onClose}>
              Close
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

// ─── Campaign card ────────────────────────────────────────────────────────────

function CampaignCard({
  summary,
  expanded,
  onToggle,
  onUpdated,
  setNotice,
  onRefreshAll,
}: {
  summary: CampaignSummary;
  expanded: boolean;
  onToggle: () => void;
  onUpdated: (c: CampaignCore) => void;
  setNotice: NoticeDispatch;
  onRefreshAll: () => void;
}) {
  const { campaign, audienceName, templateName, recipientCount, deliverySentCount } = summary;
  const [acting, setActing] = useState<string | null>(null);

  async function act(action: string, body: Record<string, unknown> = {}) {
    setActing(action);
    try {
      const data = await apiPost<{ campaign?: CampaignCore }>(
        `/marketing/campaigns/${campaign.id}/${action}`,
        body,
      );
      if (data.campaign) onUpdated(data.campaign);
      else onRefreshAll();
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : `Action "${action}" failed.`,
      });
    } finally {
      setActing(null);
    }
  }

  const state = campaign.state;
  const canRequestReview = state === "draft" || state === "needs_review";
  const canReturnForChanges = state === "needs_review";
  const canApprove = state === "needs_review";
  const canSchedule = state === "approved";
  const canSendNow = state === "approved";
  const canRetry = state === "failed";
  const canCancel = ["draft", "needs_review", "approved", "scheduled", "failed"].includes(state);

  return (
    <article
      className="rounded-xl border border-border bg-card"
      data-testid={`campaign-card-${campaign.id}`}
    >
      <div className="flex flex-wrap items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-bold">{campaign.name}</h2>
            <Badge variant={stateBadgeVariant(state)}>{STATE_LABELS[state]}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
            <span>
              Audience: <span className="font-medium text-foreground">{audienceName}</span>
            </span>
            <span>
              Template: <span className="font-medium text-foreground">{templateName}</span>
            </span>
            {recipientCount > 0 && (
              <span>
                Snapshot: <span className="font-medium text-foreground">{recipientCount}</span>
              </span>
            )}
            {(state === "sending" || state === "sent" || state === "failed") && (
              <span>
                Sent:{" "}
                <span className="font-medium text-foreground">
                  {deliverySentCount}/{recipientCount}
                </span>
              </span>
            )}
            {campaign.scheduledFor && (
              <span>
                Scheduled:{" "}
                <span className="font-medium text-foreground">
                  {formatDateTime(campaign.scheduledFor)}
                </span>
              </span>
            )}
            {campaign.sentAt && (
              <span>
                Sent at:{" "}
                <span className="font-medium text-foreground">
                  {formatDateTime(campaign.sentAt)}
                </span>
              </span>
            )}
          </div>
          {campaign.lastError ? (
            <p className="mt-1 flex items-center gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3 w-3 shrink-0" />
              {campaign.lastError}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {canRequestReview && (
            <button
              className="button-primary"
              style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
              disabled={acting !== null}
              onClick={() => void act("request-review")}
              data-testid={`campaign-request-review-${campaign.id}`}
            >
              {acting === "request-review" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : null}
              Request Review
            </button>
          )}
          {canApprove && (
            <button
              className="button-primary"
              style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
              disabled={acting !== null}
              onClick={() => void act("approve")}
              data-testid={`campaign-approve-${campaign.id}`}
            >
              {acting === "approve" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              Approve
            </button>
          )}
          {canSendNow && (
            <SendNowButton
              campaignId={campaign.id}
              recipientCount={recipientCount}
              acting={acting}
              setActing={setActing}
              onUpdated={onUpdated}
              onRefresh={onRefreshAll}
              setNotice={setNotice}
            />
          )}
          {canSchedule && (
            <ScheduleButton
              campaignId={campaign.id}
              acting={acting}
              setActing={setActing}
              onUpdated={onUpdated}
              setNotice={setNotice}
            />
          )}
          {canRetry && (
            <button
              className="button-secondary"
              style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
              disabled={acting !== null}
              onClick={() => void act("retry")}
              data-testid={`campaign-retry-${campaign.id}`}
            >
              {acting === "retry" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Retry
            </button>
          )}
          {canReturnForChanges && (
            <ReturnForChangesButton
              campaignId={campaign.id}
              acting={acting}
              setActing={setActing}
              onUpdated={onUpdated}
              setNotice={setNotice}
            />
          )}
          {canCancel && (
            <button
              className="button-secondary"
              style={{ minHeight: "2rem", padding: "0.25rem 0.75rem", fontSize: "0.75rem" }}
              disabled={acting !== null}
              onClick={() => void act("cancel")}
              data-testid={`campaign-cancel-${campaign.id}`}
            >
              Cancel
            </button>
          )}
          <TestSendButton
            campaignId={campaign.id}
            acting={acting}
            setActing={setActing}
            setNotice={setNotice}
          />
          <button
            className="button-secondary"
            style={{ minHeight: "2rem", padding: "0.25rem 0.5rem", fontSize: "0.75rem" }}
            onClick={onToggle}
            aria-expanded={expanded}
            data-testid={`campaign-expand-${campaign.id}`}
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3">
          <div className="grid gap-2">
            <div className="grid gap-0.5 text-xs">
              <span className="font-semibold text-muted-foreground">Sender</span>
              <span>
                {campaign.senderName}
                {campaign.senderEmail ? ` — ${campaign.senderEmail}` : ""}
              </span>
            </div>
            {campaign.subjectTemplate ? (
              <div className="grid gap-0.5 text-xs">
                <span className="font-semibold text-muted-foreground">Subject</span>
                <span>{campaign.subjectTemplate}</span>
              </div>
            ) : null}
            {campaign.bodyTemplate ? (
              <details>
                <summary className="cursor-pointer text-xs font-semibold text-primary">
                  View campaign copy
                </summary>
                <pre className="mt-1 whitespace-pre-wrap rounded-lg bg-muted/30 p-3 text-xs font-sans">
                  {campaign.bodyTemplate}
                </pre>
              </details>
            ) : null}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
              <span>Created {formatDateTime(campaign.createdAt)}</span>
              {campaign.requestedReviewAt && (
                <span>Review requested {formatDateTime(campaign.requestedReviewAt)}</span>
              )}
              {campaign.approvedAt && (
                <span>Approved {formatDateTime(campaign.approvedAt)}</span>
              )}
            </div>
            {(campaign.snapshotExcluded ?? []).length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Snapshot excluded {(campaign.snapshotExcluded ?? []).length} recipient
                {(campaign.snapshotExcluded ?? []).length !== 1 ? "s" : ""} — check audience
                preflight for reasons.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </article>
  );
}

// ─── CampaignHistoryTab ───────────────────────────────────────────────────────

export function CampaignHistoryTab({ setNotice }: { setNotice: NoticeDispatch }) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const fetchCampaigns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet<{ campaigns: CampaignSummary[] }>("/marketing/campaigns");
      setCampaigns(data.campaigns);
    } catch {
      setError("Could not load campaign history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void fetchCampaigns(); }, [fetchCampaigns]);

  function updateCampaignInList(updated: CampaignCore) {
    setCampaigns((prev) =>
      prev.map((c) => (c.campaign.id === updated.id ? { ...c, campaign: updated } : c)),
    );
  }

  if (loading) {
    return (
      <div className="grid gap-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
      </div>
    );
  }
  if (error) return <ErrorState message={error} onRetry={fetchCampaigns} />;

  if (campaigns.length === 0) {
    return (
      <Empty className="border border-dashed border-border">
        <EmptyHeader>
          <EmptyTitle>No campaigns yet</EmptyTitle>
          <EmptyDescription>
            Create a campaign from the Email Campaigns tab. It will appear here for review,
            approval, and sending.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <section className="grid gap-3" data-testid="campaign-history">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
        </p>
        <Button variant="outline" size="sm" onClick={fetchCampaigns}>
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>
      {campaigns.map((c) => (
        <CampaignCard
          key={c.campaign.id}
          summary={c}
          expanded={detailId === c.campaign.id}
          onToggle={() =>
            setDetailId((prev) => (prev === c.campaign.id ? null : c.campaign.id))
          }
          onUpdated={updateCampaignInList}
          setNotice={setNotice}
          onRefreshAll={fetchCampaigns}
        />
      ))}

      {detailId ? (
        <CampaignDetailDialog
          campaignId={detailId}
          onClose={() => setDetailId(null)}
        />
      ) : null}
    </section>
  );
}
