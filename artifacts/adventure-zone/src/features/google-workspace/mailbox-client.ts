import { apiFetch } from "@/lib/auth-token";
import type { GoogleThreadDetail } from "./google-workspace-client";

export type MailboxMessage = {
  id: string; threadId: string; draftId: string | null; snippet: string; labelIds: string[];
  internalDateMs: number | null; hasAttachments: boolean;
  headers: { from: string; to: string; subject: string; date: string };
  profiles: Array<{ id: string; name: string }>;
};
export type MailboxPage = { connectionId: string; email: string; messages: MailboxMessage[]; nextPageToken: string | null; unavailableCount: number };
export type MailboxThread = GoogleThreadDetail & { profiles: Array<{ id: string; name: string }>; savedCopy?: boolean; sourceState?: string; lastSyncedAt?: string | null };
export type MailboxDraft = { draftId: string; messageId: string; recipients: { to: string; cc: string; bcc: string }; revision: string; detail: GoogleThreadDetail | null; sendState: string | null };
// Only list reads are paused. Never replay a send or other mutation.
const listCooldowns = new Map<string, number>();
function rateLimitError(seconds: number) {
  return Object.assign(new Error("GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED"), { retryAfterSeconds: seconds });
}
export async function mailboxRequest<T>(path: string, body?: unknown): Promise<T> {
  const isList = body === undefined && (path === "" || path.startsWith("?"));
  const key = new URLSearchParams(path.startsWith("?") ? path.slice(1) : "").get("connectionId") || "current";
  if (isList) {
    const remaining = Math.ceil(((listCooldowns.get(key) ?? 0) - Date.now()) / 1000);
    if (remaining > 0) throw rateLimitError(remaining);
    listCooldowns.delete(key);
  }
  const response = await apiFetch(`/google-workspace/mailbox${path}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) {
    if (result.error === "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED") {
      const supplied = Number(result.retryAfterSeconds ?? response.headers.get("Retry-After"));
      const seconds = Number.isFinite(supplied) && supplied > 0 ? Math.ceil(supplied) : 60;
      if (isList) listCooldowns.set(key, Date.now() + seconds * 1000);
      throw rateLimitError(seconds);
    }
    throw new Error(result.error || "GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
  }
  return result as T;
}
export async function downloadMailboxAttachment(input: { connectionId: string; threadId: string; messageId: string; attachmentId: string; filename: string }) {
  const response = await apiFetch(`/google-workspace/mailbox/threads/${encodeURIComponent(input.threadId)}/attachments/${encodeURIComponent(input.messageId)}/${encodeURIComponent(input.attachmentId)}?connectionId=${encodeURIComponent(input.connectionId)}`);
  if (!response.ok) throw new Error("Attachment unavailable. Try again.");
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = input.filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function mailboxError(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "GOOGLE_WORKSPACE_GMAIL_RATE_LIMITED") {
    const seconds = Number((error as { retryAfterSeconds?: number }).retryAfterSeconds);
    const minutes = Math.max(1, Math.ceil((Number.isFinite(seconds) ? seconds : 60) / 60));
    return `Gmail has temporarily limited email requests. Wait about ${minutes} minute${minutes === 1 ? "" : "s"} before refreshing. You do not need to reconnect your account.`;
  }
  if (/NOT_CONNECTED/.test(code)) return "Connect your email account in Google Workspace settings.";
  if (/REAUTHORIZATION/.test(code)) return "Reconnect your Google account to grant the required email permissions.";
  if (/CONNECTION_CHANGED/.test(code)) return "The connected account changed. Refresh Emails before continuing.";
  if (/LINK_CONFLICT/.test(code)) return "This conversation is already linked to another profile. Review the existing link before changing it.";
  if (/DRAFT_CHANGED/.test(code)) return "This draft changed in Gmail. Open it again to review the current version.";
  if (/SEND_OUTCOME_UNCERTAIN/.test(code)) return "The send outcome is uncertain. Check Sent in Gmail before taking further action. The app will not resend this draft.";
  if (/SOURCE_NOT_FOUND/.test(code)) return "This message or draft is no longer available in Gmail.";
  return "Email is temporarily unavailable. Try again.";
}

