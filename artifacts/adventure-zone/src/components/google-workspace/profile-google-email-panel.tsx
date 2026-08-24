import { useEffect, useState } from "react";
import { ExternalLink, FileText, Mail } from "lucide-react";

import {
  getGoogleProfileEmails,
  getGoogleProfileEmailThread,
  type GoogleProfileEmailConversation,
  type GoogleThreadDetail,
} from "@/features/google-workspace/google-workspace-client";

function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function ThreadDetail({ thread }: { thread: GoogleThreadDetail }) {
  return (
    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Complete conversation · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
        </p>
        <a
          className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
          href={thread.originalGmailUrl}
          rel="noreferrer"
          target="_blank"
        >
          Open in Gmail <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
      {thread.messages.map((message) => (
        <article
          className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/40"
          key={message.id}
        >
          <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div>
              <p className="font-semibold text-slate-700 dark:text-slate-200">
                {message.from || "Unknown sender"}
              </p>
              <p>To: {message.to || "Unknown recipient"}</p>
            </div>
            <span className="capitalize">{message.direction}</span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
            {message.bodyText || "(No readable text body)"}
          </p>
          {message.attachments.length > 0 ? (
            <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                Attachments
              </p>
              {message.attachments.map((attachment) => (
                <div
                  className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-900"
                  key={`${message.id}:${attachment.attachmentId}`}
                >
                  <FileText className="h-4 w-4 shrink-0 text-slate-500" />
                  <span className="min-w-0 flex-1 break-words font-medium">
                    {attachment.filename}
                  </span>
                  <span className="text-xs text-slate-500">
                    {fileSize(attachment.sizeBytes)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ConversationCard({
  organizationId,
  conversation,
}: {
  organizationId: string;
  conversation: GoogleProfileEmailConversation;
}) {
  const [thread, setThread] = useState<GoogleThreadDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (thread) {
      setThread(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setThread(
        await getGoogleProfileEmailThread(organizationId, conversation.threadId),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open Gmail thread.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <button
        aria-expanded={Boolean(thread)}
        className="w-full text-left"
        disabled={loading}
        onClick={() => void toggle()}
        type="button"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="break-words font-semibold text-slate-900 dark:text-slate-100">
              {conversation.subject || "(No subject)"}
            </p>
            <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
              {conversation.from || "Unknown sender"}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
            {conversation.hasAttachments ? <span>Attachment</span> : null}
            <span>{loading ? "Opening…" : thread ? "Hide" : "Open"}</span>
          </div>
        </div>
      </button>
      {error ? (
        <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}
      {thread ? <ThreadDetail thread={thread} /> : null}
    </article>
  );
}

export function ProfileGoogleEmailPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const [conversations, setConversations] = useState<GoogleProfileEmailConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getGoogleProfileEmails(organizationId)
      .then((result) => {
        if (active) setConversations(result.conversations);
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : "Could not load Gmail conversations.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/20">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />
        <div>
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Emails
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Gmail conversations attached to this profile from the approved validation sample. Full historical email import is still off.
          </p>
        </div>
      </div>

      {loading ? <p className="mt-3 text-sm text-slate-500">Loading emails…</p> : null}
      {error ? <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
      {!loading && !error && conversations.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">
          No emails from the approved validation sample are attached to this profile yet.
        </p>
      ) : null}
      {conversations.length > 0 ? (
        <div className="mt-3 grid gap-2">
          {conversations.map((conversation) => (
            <ConversationCard
              conversation={conversation}
              key={conversation.threadId}
              organizationId={organizationId}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
