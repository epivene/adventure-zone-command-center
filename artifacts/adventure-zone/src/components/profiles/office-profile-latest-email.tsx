import { Button } from "@workspace/avz-crm/components/ui/button";
import { Link } from "wouter";
import type { OfficeEmailDraft } from "@/components/office/office-email-editor";

const stateLabels: Record<OfficeEmailDraft["state"], string> = {
  draft: "Draft — not sent",
  submitted: "Awaiting review — not sent",
  needs_changes: "Needs changes",
  sending: "Sending",
  sent: "Sent",
};

export function OfficeProfileLatestEmail({ profileId, draft, loading = false, error, onRetry }: {
  profileId: string;
  draft: Pick<OfficeEmailDraft, "id" | "subject" | "recipientEmail" | "state" | "updatedAt"> | null;
  loading?: boolean;
  error?: string;
  onRetry?(): void;
}) {
  const params = new URLSearchParams({ profileId });
  const href = draft
    ? `/office/emails?draftId=${encodeURIComponent(draft.id)}`
    : `/office/emails?${params}`;

  return <section className="grid gap-2 border-t border-border pt-3" data-testid="office-profile-latest-email" aria-label="Latest profile email">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm font-semibold">Latest email</p>
      <Button asChild variant="outline" size="sm">
        <Link data-testid="link-open-office-profile-email" href={href}>{draft ? "Open email" : "Draft Email"}</Link>
      </Button>
    </div>
    {loading ? <p className="text-sm text-muted-foreground" role="status">Loading profile emails…</p> : error ? <div className="grid gap-2">
      <p className="text-sm text-destructive" role="alert">{error}</p>
      {onRetry ? <Button variant="outline" size="sm" className="w-fit" onClick={onRetry}>Retry emails</Button> : null}
    </div> : draft ? <>
      <p className="break-words font-semibold" data-testid="text-office-profile-email-subject">{draft.subject || "(No subject)"}</p>
      <p className="break-all text-xs text-muted-foreground">To: {draft.recipientEmail}</p>
      <p className="text-xs text-muted-foreground">{stateLabels[draft.state]} · Updated {new Date(draft.updatedAt).toLocaleDateString()}</p>
    </> : <p className="text-sm text-muted-foreground">No profile emails yet.</p>}
  </section>;
}
