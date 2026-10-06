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
export async function mailboxRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await apiFetch(`/google-workspace/mailbox${path}`, body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "GOOGLE_WORKSPACE_MAILBOX_UNAVAILABLE");
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
  if (/NOT_CONNECTED/.test(code)) return "Connect your email account in Google Workspace settings.";
  if (/REAUTHORIZATION/.test(code)) return "Reconnect your Google account to grant the required email permissions.";
  if (/CONNECTION_CHANGED/.test(code)) return "The connected account changed. Refresh Emails before continuing.";
  if (/LINK_CONFLICT/.test(code)) return "This conversation is already linked to another profile. Review the existing link before changing it.";
  if (/DRAFT_CHANGED/.test(code)) return "This draft changed in Gmail. Open it again to review the current version.";
  if (/SEND_OUTCOME_UNCERTAIN/.test(code)) return "The send outcome is uncertain. Check Sent in Gmail before taking further action. The app will not resend this draft.";
  if (/SOURCE_NOT_FOUND/.test(code)) return "This message or draft is no longer available in Gmail.";
  return "Email is temporarily unavailable. Try again.";
}
