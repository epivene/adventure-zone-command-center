import { useEffect, useState } from "react";
import { bossGet } from "@/lib/boss-auth-context";
import { ProfileGoogleConversationCard } from "@/components/google-workspace/profile-google-email-panel";
import { useProfileGoogleEmail, type ProfileGoogleEmailState } from "@/components/google-workspace/use-profile-google-email";
import type { GoogleProfileEmailList, GoogleThreadDetail } from "@/features/google-workspace/google-workspace-client";

type Draft = { id: string; subject: string; body: string; recipientEmail: string; state: string };
const stateLabels: Record<string, string> = { draft: "Draft — not sent", submitted: "Awaiting review — not sent", needs_changes: "Needs changes — not sent", sending: "Sending", sent: "Sent", cancelled: "Cancelled — not sent" };
export const getBossProfileEmails = (id: string) =>
  bossGet<GoogleProfileEmailList>(`/boss/google-workspace/profiles/${encodeURIComponent(id)}/emails`);
export const getBossThread = (id: string, threadId: string) =>
  bossGet<GoogleThreadDetail>(`/boss/google-workspace/profiles/${encodeURIComponent(id)}/emails/${encodeURIComponent(threadId)}`);
export const getBossProfileDrafts = (id: string) =>
  bossGet<{ drafts: import("@/components/profiles/profile-email-composer").ProfileEmailDraft[] }>(`/boss/profiles/${encodeURIComponent(id)}/email-drafts`);
const noFilesCopied = () => {};

type Props = { organizationId: string; state?: ProfileGoogleEmailState; compact?: boolean; onViewAll?: () => void };
export function BossProfileEmails(props: Props) {
  return props.state ? <EmailView {...props} state={props.state} /> : <EmailLoader {...props} />;
}
function EmailLoader(props: Props) {
  const state = useProfileGoogleEmail(props.organizationId, undefined, getBossProfileEmails);
  return <EmailView {...props} state={state} />;
}
function EmailView({ organizationId, state, compact = false, onViewAll }: Props & { state: ProfileGoogleEmailState }) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [draftError, setDraftError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (compact) return;
    let active = true;
    setDrafts([]); setDraftError("");
    void bossGet<{ drafts: Draft[] }>(`/boss/profiles/${encodeURIComponent(organizationId)}/email-drafts`)
      .then((result) => { if (active) setDrafts(result.drafts ?? []); })
      .catch(() => { if (active) setDraftError("Could not load saved email drafts."); });
    return () => { active = false; };
  }, [organizationId, compact, revision]);
  const cards = (rows: ProfileGoogleEmailState["conversations"]) => rows.map((conversation) =>
    <ProfileGoogleConversationCard key={conversation.threadId} organizationId={organizationId}
      conversation={conversation} compact={compact} readOnly getThread={getBossThread} onFilesCopied={noFilesCopied} />);
  return <section className="min-w-0 rounded-xl border border-border bg-card p-4">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{compact ? "Recent emails" : "Emails"}</h2>
      {compact && onViewAll ? <button className="text-sm font-semibold text-primary" type="button" onClick={onViewAll}>View all emails</button> : null}
    </div>
    {state.loading ? <p role="status" className="mt-3 text-sm text-muted-foreground">Loading emails…</p> : null}
    {state.error || draftError ? <div role="alert" className="mt-3 text-sm text-destructive">
      <p>{state.error}</p><p>{draftError}</p>
      <button className="button-secondary mt-2" type="button" onClick={() => { void state.reload(); setRevision((value) => value + 1); }}>Retry emails</button>
    </div> : null}
    {!state.loading && !state.error && !state.conversations.length ? <p className="mt-3 text-sm text-muted-foreground">No email conversations for this profile.</p> : null}
    {compact ? <div className="mt-3 grid gap-2">{cards(state.conversations.slice(0, 3))}</div> : <>
      <p className="mt-3 text-xs font-bold uppercase text-muted-foreground">{new Date().getUTCFullYear()} emails ({state.current.length})</p>
      <div className="mt-2 grid gap-2">{cards(state.current)}</div>
      {state.historical.length ? <details className="mt-4 rounded-xl border border-border p-3">
        <summary className="cursor-pointer font-semibold">Earlier Gmail history ({state.historical.length})</summary>
        <div className="mt-3 grid gap-2">{cards(state.historical)}</div>
      </details> : null}
      {drafts.length ? <details className="mt-4 rounded-xl border border-border p-3">
        <summary className="cursor-pointer font-semibold">Saved drafts ({drafts.length})</summary>
        <div className="mt-3 grid gap-2">{drafts.map((draft) => <details className="rounded-lg border border-border p-3" key={draft.id}>
          <summary className="cursor-pointer font-semibold">{draft.subject} <span className="text-sm font-normal text-muted-foreground">· {stateLabels[draft.state] ?? draft.state}</span></summary>
          <p className="mt-2 break-words text-sm text-muted-foreground">To: {draft.recipientEmail}</p>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm">{draft.body}</p>
        </details>)}</div>
      </details> : null}
    </>}
  </section>;
}
