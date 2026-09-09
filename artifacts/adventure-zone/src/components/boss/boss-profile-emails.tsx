import { useEffect, useState } from "react";
import { Mail } from "lucide-react";
import { bossGet } from "@/lib/boss-auth-context";
import type { GoogleProfileEmailConversation, GoogleProfileEmailList, GoogleThreadDetail } from "@/features/google-workspace/google-workspace-client";

type Draft = { id: string; subject: string; body: string; recipientEmail: string; state: string; sentAt: string | null; updatedAt: string };
const stateLabels: Record<string, string> = { draft: "Draft — not sent", submitted: "Awaiting review — not sent", needs_changes: "Needs changes — not sent", sending: "Sending", sent: "Sent", cancelled: "Cancelled — not sent" };

function Conversation({ organizationId, conversation }: { organizationId: string; conversation: GoogleProfileEmailConversation }) {
  const [thread, setThread] = useState<GoogleThreadDetail | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function toggle() {
    if (open) { setOpen(false); return; }
    if (thread) { setOpen(true); return; }
    setBusy(true);
    setError("");
    try {
      const result = await bossGet<GoogleThreadDetail>(`/boss/google-workspace/profiles/${encodeURIComponent(organizationId)}/emails/${encodeURIComponent(conversation.threadId)}`);
      setThread(result);
      setOpen(true);
    } catch { setError("Could not open this conversation. Try again."); }
    finally { setBusy(false); }
  }
  return <article className="rounded-lg border border-border p-3">
    <button type="button" className="w-full text-left" aria-expanded={open} disabled={busy} onClick={() => void toggle()}>
      <span className="block font-semibold">{conversation.subject || "(No subject)"}</span>
      <span className="block break-words text-sm text-muted-foreground">{conversation.from} · {conversation.date}</span>
      <span className="text-sm text-primary">{busy ? "Opening…" : open ? "Hide conversation" : "Read conversation"}</span>
    </button>
    {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
    {open && thread ? <div className="mt-3 grid gap-3 border-t pt-3">{thread.messages.map((message) => <div key={message.id} className="rounded-lg bg-muted/40 p-3">
      <p className="break-words text-sm font-semibold">From: {message.from}</p>
      <p className="break-words text-sm text-muted-foreground">To: {message.to}</p>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{message.bodyText || "(No readable text body)"}</p>
      {message.attachments.length ? <p className="mt-2 break-words text-xs text-muted-foreground">Attachments: {message.attachments.map((attachment) => attachment.filename).join(", ")}</p> : null}
    </div>)}</div> : null}
  </article>;
}

export function BossProfileEmails({ organizationId }: { organizationId: string }) {
  const [opened, setOpened] = useState(false);
  const [emails, setEmails] = useState<GoogleProfileEmailConversation[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [emailError, setEmailError] = useState("");
  const [draftError, setDraftError] = useState("");
  const [loading, setLoading] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!opened) return;
    let active = true;
    setLoading(true);
    setEmailError(""); setDraftError(""); setEmails([]); setDrafts([]);
    Promise.allSettled([
      bossGet<GoogleProfileEmailList>(`/boss/google-workspace/profiles/${encodeURIComponent(organizationId)}/emails`),
      bossGet<{ drafts: Draft[] }>(`/boss/profiles/${encodeURIComponent(organizationId)}/email-drafts`),
    ]).then(([history, saved]) => {
      if (!active) return;
      if (history.status === "fulfilled") {
        const all = [...history.value.conversations, ...(history.value.historicalConversations ?? [])];
        setEmails([...new Map(all.map((email) => [email.threadId, email])).values()]);
        if (history.value.unavailableThreadCount) setEmailError("Some linked conversations are currently unavailable.");
      } else setEmailError("Could not load linked email conversations.");
      if (saved.status === "fulfilled") setDrafts(saved.value.drafts);
      else setDraftError("Could not load saved email drafts.");
      setLoading(false);
    });
    return () => { active = false; };
  }, [organizationId, opened, revision]);
  return <section className="rounded-xl border border-border bg-card p-4">
    <button type="button" className="flex w-full items-center gap-2 text-left" aria-expanded={opened} onClick={() => setOpened(!opened)}>
      <Mail className="h-5 w-5 text-primary" /><span className="text-lg font-bold">Emails</span><span className="ml-auto text-sm text-primary">{opened ? "Hide" : "View emails"}</span>
    </button>
    {opened ? <div className="mt-4 grid gap-3">
      {loading ? <p role="status">Loading emails…</p> : null}
      {emailError || draftError ? <div role="alert" className="text-sm text-destructive"><p>{emailError}</p><p>{draftError}</p><button type="button" className="button-secondary mt-2" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Retry</button></div> : null}
      <h3 className="font-semibold">Saved app emails & drafts</h3>
      {!loading && !draftError && !drafts.length ? <p className="text-sm text-muted-foreground">No saved app emails or drafts for this profile.</p> : null}
      {drafts.map((draft) => <details className="rounded-lg border border-border p-3" key={draft.id}>
        <summary className="cursor-pointer font-semibold">{draft.subject} <span className="text-sm font-normal text-muted-foreground">· {stateLabels[draft.state] ?? draft.state}</span></summary>
        <p className="mt-2 break-words text-sm text-muted-foreground">To: {draft.recipientEmail}</p>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm">{draft.body}</p>
      </details>)}
      <h3 className="mt-2 font-semibold">Linked Gmail conversations</h3>
      {!loading && !emailError && !emails.length ? <p className="text-sm text-muted-foreground">No linked Gmail conversations for this profile.</p> : null}
      {emails.map((conversation) => <Conversation key={conversation.threadId} organizationId={organizationId} conversation={conversation} />)}
    </div> : null}
  </section>;
}
