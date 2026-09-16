import { useEffect, useState } from "react";
import { ExternalLink, FileText, Mail, Paperclip } from "lucide-react";

import {
  copyGoogleProfileThreadFiles,
  getGoogleProfileEmailThread,
  getGoogleProfileFiles,
  openGoogleProfileFile,
  replyToGoogleProfileEmail,
  type GoogleProfileEmailConversation,
  type GoogleProfileFile,
  type GoogleThreadDetail,
} from "@/features/google-workspace/google-workspace-client";
import { useProfileGoogleEmail } from "./use-profile-google-email";

function fileSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function savedCopyLabel(thread: GoogleThreadDetail): string | null {
  if (thread.sourceState === "saved_copy_gmail_missing") {
    return "Saved in app; no longer in Gmail";
  }
  if (thread.sourceState === "saved_copy_gmail_unavailable") {
    return "Showing saved copy";
  }
  return thread.savedCopy ? "Saved in app" : null;
}

function ThreadDetail({
  organizationId,
  thread,
  onFilesCopied,
  onThreadUpdated,
}: {
  organizationId: string;
  thread: GoogleThreadDetail;
  onFilesCopied(files: GoogleProfileFile[]): void;
  onThreadUpdated(thread: GoogleThreadDetail): void;
}) {
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [replyError, setReplyError] = useState<string | null>(null);
  const attachments = thread.messages.flatMap((message) => message.attachments);
  const savedLabel = savedCopyLabel(thread);

  async function saveAttachments() {
    setCopying(true);
    setCopyError(null);
    try {
      const result = await copyGoogleProfileThreadFiles(organizationId, thread.id);
      onFilesCopied(result.files);
    } catch (caught) {
      setCopyError(caught instanceof Error ? caught.message : "Could not save attachments.");
    } finally {
      setCopying(false);
    }
  }

  async function sendReply() {
    const bodyText = replyText.trim();
    if (!bodyText || !thread.conversationId) return;
    setReplying(true);
    setReplyError(null);
    try {
      const updated = await replyToGoogleProfileEmail(
        organizationId,
        thread.conversationId,
        bodyText,
      );
      onThreadUpdated(updated);
      setReplyText("");
    } catch (caught) {
      setReplyError(
        caught instanceof Error
          ? caught.message
          : "Could not send. Your reply is still here so you can retry.",
      );
    } finally {
      setReplying(false);
    }
  }

  return (
    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          Complete conversation · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {attachments.length > 0 ? (
            <button
              className="button-secondary px-3 py-1.5 text-xs"
              disabled={copying}
              onClick={() => void saveAttachments()}
              type="button"
            >
              {copying ? "Saving attachments…" : "Save attachments to Files"}
            </button>
          ) : null}
          {thread.sourceState !== "saved_copy_gmail_missing" ? <a
            className="inline-flex items-center gap-1 text-xs font-semibold text-orange-700 hover:underline dark:text-orange-300"
            href={thread.originalGmailUrl}
            rel="noreferrer"
            target="_blank"
          >
            Open in Gmail <ExternalLink className="h-3.5 w-3.5" />
          </a> : null}
        </div>
      </div>
      {copyError ? <p className="text-xs font-medium text-rose-700">{copyError}</p> : null}
      {savedLabel ? (
        <p className="w-fit rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          {savedLabel}
        </p>
      ) : null}
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
      {thread.conversationId ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
          <label
            className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300"
            htmlFor={`profile-email-reply-${thread.conversationId}`}
          >
            Reply from the app
          </label>
          <textarea
            className="mt-2 min-h-28 w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
            disabled={replying}
            id={`profile-email-reply-${thread.conversationId}`}
            onChange={(event) => setReplyText(event.target.value)}
            placeholder="Write a reply…"
            value={replyText}
          />
          {replyError ? (
            <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-300">
              Could not send. Your reply was kept. {replyError}
            </p>
          ) : null}
          <div className="mt-2 flex justify-end">
            <button
              className="button-primary px-4 py-2 text-sm"
              disabled={replying || !replyText.trim()}
              onClick={() => void sendReply()}
              type="button"
            >
              {replying ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProfileGoogleConversationCard({
  organizationId,
  conversation,
  onFilesCopied,
  compact = false,
}: {
  organizationId: string;
  conversation: GoogleProfileEmailConversation;
  onFilesCopied(files: GoogleProfileFile[]): void;
  compact?: boolean;
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
    <article className={`${compact ? "rounded-md border-[#d8d1c4] bg-[#f6f2e9] p-2" : "rounded-xl border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40"} border`}>
      <button
        aria-expanded={Boolean(thread)}
        aria-label={conversation.subject || "Open email conversation"}
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
      {thread ? (
        <ThreadDetail
          onFilesCopied={onFilesCopied}
          onThreadUpdated={setThread}
          organizationId={organizationId}
          thread={thread}
        />
      ) : null}
    </article>
  );
}

function ProfileFiles({
  organizationId,
  files,
}: {
  organizationId: string;
  files: GoogleProfileFile[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function open(file: GoogleProfileFile) {
    if (file.availability !== "available") return;
    setBusyId(file.id);
    setError(null);
    try {
      const result = await openGoogleProfileFile(organizationId, file.id);
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not open file.");
    } finally {
      setBusyId(null);
    }
  }

  if (!files.length) {
    return (
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500 dark:bg-slate-900">
        No Gmail attachments have been saved to this profile yet. Open an email with an attachment and choose “Save attachments to Files.”
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {error ? <p className="text-sm font-medium text-rose-700">{error}</p> : null}
      {files.map((file) => (
        <article className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/40" key={file.id}>
          <Paperclip className="h-5 w-5 shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1">
            <p className="break-words font-semibold text-slate-900 dark:text-slate-100">{file.filename}</p>
            <p className="mt-1 text-xs text-slate-500">{file.mimeType} · {fileSize(file.sizeBytes)}</p>
            {file.availability !== "available" ? (
              <p className="mt-1 text-xs font-semibold text-amber-700">Attachment needs retry</p>
            ) : null}
          </div>
          {file.availability === "available" ? (
            <button
              className="button-secondary px-3 py-1.5 text-sm"
              disabled={busyId !== null}
              onClick={() => void open(file)}
              type="button"
            >
              {busyId === file.id ? "Opening…" : "Open file"}
            </button>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function ProfileGoogleEmailPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const [tab, setTab] = useState<"emails" | "files">("emails");
  const [files, setFiles] = useState<GoogleProfileFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);
  const currentYear = new Date().getUTCFullYear();
  const {
    current: conversations,
    historical: historicalConversations,
    loading,
    error,
  } = useProfileGoogleEmail(organizationId, currentYear);

  useEffect(() => {
    let active = true;
    setFilesLoading(true);
    setFilesError(null);
    void getGoogleProfileFiles(organizationId)
      .then((fileResult) => {
        if (!active) return;
        setFiles(fileResult.files);
      })
      .catch((caught) => {
        if (active) {
          setFilesError(
            caught instanceof Error ? caught.message : "Could not load profile files.",
          );
        }
      })
      .finally(() => {
        if (active) {
          setFilesLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [organizationId]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-950/20">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Google history
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Emails assigned to this profile are saved in the app automatically, including attachment copies. They remain available here even if the Gmail original is deleted.
          </p>
          <div className="mt-3 flex gap-2 border-b border-slate-200 dark:border-slate-700">
            <button
              className={`px-3 py-2 text-sm font-semibold ${tab === "emails" ? "border-b-2 border-orange-500 text-orange-700" : "text-slate-500"}`}
              onClick={() => setTab("emails")}
              type="button"
            >
              Emails
            </button>
            <button
              className={`px-3 py-2 text-sm font-semibold ${tab === "files" ? "border-b-2 border-orange-500 text-orange-700" : "text-slate-500"}`}
              onClick={() => setTab("files")}
              type="button"
            >
              Files
            </button>
          </div>
        </div>
      </div>

      {error ? <p className="mt-3 text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}

      {tab === "emails" ? (
        <>
          {loading ? <p className="mt-3 text-sm text-slate-500">Loading emails…</p> : null}
          {!loading && !error ? (
            <div className="mt-3">
              <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                {currentYear} emails ({conversations.length})
              </p>
            </div>
          ) : null}
          {!loading && !error && conversations.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">
              No matched Gmail conversations for {currentYear} are attached to this profile yet.
            </p>
          ) : null}
          {conversations.length > 0 ? (
            <div className="mt-2 grid gap-2">
              {conversations.map((conversation) => (
                <ProfileGoogleConversationCard
                  conversation={conversation}
                  key={conversation.threadId}
                  onFilesCopied={setFiles}
                  organizationId={organizationId}
                />
              ))}
            </div>
          ) : null}
          {!loading && !error && historicalConversations.length > 0 ? (
            <details className="mt-4 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/20">
              <summary className="cursor-pointer text-sm font-semibold text-slate-700 dark:text-slate-200">
                Earlier Gmail history ({historicalConversations.length})
              </summary>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                Older conversations are preserved for relationship context but are not counted as current-year emails.
              </p>
              <div className="mt-3 grid gap-2">
                {historicalConversations.map((conversation) => (
                  <ProfileGoogleConversationCard
                    conversation={conversation}
                    key={conversation.threadId}
                    onFilesCopied={setFiles}
                    organizationId={organizationId}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <div className="mt-3">
          {filesError ? <p className="mb-3 text-sm text-rose-700">{filesError}</p> : null}
          {filesLoading ? <p className="text-sm text-slate-500">Loading files…</p> : (
            <ProfileFiles files={files} organizationId={organizationId} />
          )}
        </div>
      )}
    </section>
  );
}
