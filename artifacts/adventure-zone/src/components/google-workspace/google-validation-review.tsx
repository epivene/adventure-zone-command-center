import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";

import {
  createGoogleReviewNewProfile,
  suggestedGoogleReviewProfile,
  type GoogleReviewNewProfileInput,
} from "@/features/google-workspace/google-review-new-profile";
import {
  deleteGoogleProfileLabels,
  getGoogleProfileLabelCleanupPreview,
  getGoogleWorkspaceValidationReview,
  getGoogleWorkspaceValidationReviewThread,
  getGoogleWorkspaceValidationReviewAttachment,
  ignoreGoogleWorkspaceValidationReview,
  resolveGoogleWorkspaceValidationReview,
  retryGoogleWorkspaceGmailMutation,
  runGoogleWorkspaceRecentValidation,
  type GoogleProfileLabelCleanupCandidate,
  type GoogleProfileLabelSyncResult,
  type GoogleThreadDetail,
  type GoogleValidationReviewItem,
} from "@/features/google-workspace/google-workspace-client";
import {
  searchGoogleReviewProfiles,
  type GoogleReviewProfileSearchResult,
} from "@/features/google-workspace/google-review-profile-search";

type SearchState = {
  query: string;
  results: GoogleReviewProfileSearchResult[];
  searching: boolean;
};

type CreateState = GoogleReviewNewProfileInput & { open: boolean };

type GmailNotice = {
  message: string;
  mutationId: string | null;
  needsRetry: boolean;
};

function gmailNotice(result?: GoogleProfileLabelSyncResult): GmailNotice {
  if (result?.errorCode === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED") {
    return {
      message: "Profile assigned. Reconnect the company Google account in Settings, then retry Gmail.",
      mutationId: result.mutationId,
      needsRetry: true,
    };
  }
  if (!result || result.state === "completed") {
    return {
      message: "Assigned to the profile and archived in Gmail.",
      mutationId: null,
      needsRetry: false,
    };
  }
  if (result.state === "retryable_error") {
    return {
      message: "Profile assigned. The Gmail update needs a retry.",
      mutationId: result.mutationId,
      needsRetry: true,
    };
  }
  if (result.state === "conflict") {
    return {
      message: "Profile assigned, but Gmail has conflicting profile labels. No duplicate label was created.",
      mutationId: null,
      needsRetry: false,
    };
  }
  return {
    message: "Profile assigned, but Gmail could not be updated. Reconnect Gmail if prompted.",
    mutationId: null,
    needsRetry: false,
  };
}

export function GoogleValidationReview({
  checkGmailOnMount = false,
  onPendingCountChange,
  showHistory = false,
}: {
  checkGmailOnMount?: boolean;
  onPendingCountChange?(count: number): void;
  showHistory?: boolean;
} = {}) {
  const [items, setItems] = useState<GoogleValidationReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [busyMessageId, setBusyMessageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gmailStatus, setGmailStatus] = useState<GmailNotice | null>(null);
  const [retryingMutationId, setRetryingMutationId] = useState<string | null>(null);
  const [searchByMessage, setSearchByMessage] = useState<Record<string, SearchState>>({});
  const [createByMessage, setCreateByMessage] = useState<Record<string, CreateState>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [threadByMessage, setThreadByMessage] = useState<Record<string, GoogleThreadDetail>>({});
  const [openingMessageIds, setOpeningMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openingAttachmentKeys, setOpeningAttachmentKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const [threadErrorByMessage, setThreadErrorByMessage] = useState<Record<string, string>>({});
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupDeleting, setCleanupDeleting] = useState(false);
  const [cleanupLabels, setCleanupLabels] = useState<
    GoogleProfileLabelCleanupCandidate[]
  >([]);
  const [selectedCleanupLabelIds, setSelectedCleanupLabelIds] = useState<
    string[]
  >([]);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);

  async function load(): Promise<boolean> {
    setError(null);
    try {
      const result = await getGoogleWorkspaceValidationReview();
      setItems(result.items);
      const pendingCount = result.items.filter((item) => item.state === "pending").length;
      onPendingCountChange?.(pendingCount);
      window.dispatchEvent(new CustomEvent("email-review-count-changed", { detail: pendingCount }));
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load email review items.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function checkEmails() {
    setChecking(true);
    let checkFailed = false;
    try {
      await runGoogleWorkspaceRecentValidation(100);
    } catch {
      checkFailed = true;
    }
    const queueLoaded = await load();
    if (checkFailed && queueLoaded) {
      setError("Could not check Gmail. Showing saved email review items.");
    }
    setChecking(false);
  }

  async function toggleLabelCleanup() {
    if (cleanupOpen) {
      setCleanupOpen(false);
      return;
    }
    setCleanupLoading(true);
    setError(null);
    setCleanupStatus(null);
    try {
      const result = await getGoogleProfileLabelCleanupPreview();
      setCleanupLabels(result.labels);
      setSelectedCleanupLabelIds([]);
      setCleanupOpen(true);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not check Gmail labels.",
      );
    } finally {
      setCleanupLoading(false);
    }
  }

  function toggleCleanupLabel(labelId: string) {
    setSelectedCleanupLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    );
  }

  async function deleteSelectedCleanupLabels() {
    const count = selectedCleanupLabelIds.length;
    if (!count) return;
    const confirmed = window.confirm(
      `Delete ${count} selected Gmail label${count === 1 ? "" : "s"}? This removes only labels; no emails will be deleted.`,
    );
    if (!confirmed) return;

    setCleanupDeleting(true);
    setError(null);
    setCleanupStatus(null);
    try {
      const selected = [...selectedCleanupLabelIds];
      const result = await deleteGoogleProfileLabels(selected);
      const removedIds = new Set([
        ...result.deleted.map((label) => label.id),
        ...result.skippedLabelIds,
      ]);
      setCleanupLabels((current) =>
        current.filter((label) => !removedIds.has(label.id)),
      );
      setSelectedCleanupLabelIds(
        result.failed.map((failure) => failure.id),
      );
      const deletedCount = result.deleted.length;
      const failedCount = result.failed.length;
      if (deletedCount) {
        setCleanupStatus(
          `Deleted ${deletedCount} old Gmail label${deletedCount === 1 ? "" : "s"}. No emails were deleted.` +
            (failedCount
              ? ` ${failedCount} label${failedCount === 1 ? "" : "s"} could not be deleted and remain selected.`
              : ""),
        );
      } else if (failedCount) {
        setCleanupStatus(
          `No labels were deleted. ${failedCount} label${failedCount === 1 ? "" : "s"} could not be deleted and remain selected.`,
        );
      } else {
        setCleanupStatus(
          "No labels were deleted after the safety re-check.",
        );
      }
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not delete the selected Gmail labels.",
      );
    } finally {
      setCleanupDeleting(false);
    }
  }

  useEffect(() => {
    if (checkGmailOnMount) void checkEmails();
    else void load();
  }, [checkGmailOnMount]);

  const pending = useMemo(
    () => items.filter((item) => item.state === "pending"),
    [items],
  );
  const resolvedCount = items.filter((item) => item.state === "resolved").length;
  const ignoredCount = items.filter((item) => item.state === "ignored").length;
  const history = items.filter((item) => item.state !== "pending");

  async function assign(item: GoogleValidationReviewItem, organizationId: string) {
    setBusyMessageId(item.messageId);
    setError(null);
    try {
      const result = await resolveGoogleWorkspaceValidationReview(
        item.messageId,
        organizationId,
      );
      setGmailStatus(gmailNotice(result.gmailSync));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not assign this email.");
    } finally {
      setBusyMessageId(null);
    }
  }

  async function ignore(item: GoogleValidationReviewItem) {
    setBusyMessageId(item.messageId);
    setError(null);
    try {
      await ignoreGoogleWorkspaceValidationReview(item.messageId);
      setGmailStatus({
        message: "Ignored in Email Review. Gmail was left unchanged and the thread stays in Inbox.",
        mutationId: null,
        needsRetry: false,
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not ignore this email.");
    } finally {
      setBusyMessageId(null);
    }
  }

  function toggleCreate(item: GoogleValidationReviewItem) {
    setCreateByMessage((current) => {
      const existing = current[item.messageId];
      if (existing) {
        return {
          ...current,
          [item.messageId]: { ...existing, open: !existing.open },
        };
      }
      return {
        ...current,
        [item.messageId]: {
          ...suggestedGoogleReviewProfile(item),
          open: true,
        },
      };
    });
  }

  function updateCreate(
    messageId: string,
    field: keyof GoogleReviewNewProfileInput,
    value: string,
  ) {
    setCreateByMessage((current) => ({
      ...current,
      [messageId]: {
        ...(current[messageId] ?? {
          profileName: "",
          city: "",
          region: "",
          contactName: "",
          contactEmail: "",
          open: true,
        }),
        [field]: value,
        open: true,
      },
    }));
  }

  async function createNewProfile(item: GoogleValidationReviewItem) {
    const createState = createByMessage[item.messageId] ?? {
      ...suggestedGoogleReviewProfile(item),
      open: true,
    };
    setBusyMessageId(item.messageId);
    setError(null);
    try {
      const created = await createGoogleReviewNewProfile(item, createState);
      setGmailStatus(gmailNotice(created.gmailSync));
      setCreateByMessage((current) => {
        const next = { ...current };
        delete next[item.messageId];
        return next;
      });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the new profile.");
    } finally {
      setBusyMessageId(null);
    }
  }

  async function retryGmail(mutationId: string) {
    setRetryingMutationId(mutationId);
    setError(null);
    try {
      const result = await retryGoogleWorkspaceGmailMutation(mutationId);
      setGmailStatus(gmailNotice(result.gmailSync));
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry the Gmail update.");
    } finally {
      setRetryingMutationId(null);
    }
  }

  async function openAttachment(
    item: GoogleValidationReviewItem,
    gmailMessageId: string,
    attachmentId: string,
    filename: string,
  ) {
    const key = `${gmailMessageId}:${attachmentId}`;
    const popup = window.open("", "_blank");
    if (!popup) {
      setThreadErrorByMessage((current) => ({
        ...current,
        [item.messageId]: "Allow pop-ups to open this attachment.",
      }));
      return;
    }
    popup.opener = null;
    setOpeningAttachmentKeys((current) => new Set(current).add(key));
    setThreadErrorByMessage((current) => ({ ...current, [item.messageId]: "" }));
    try {
      const blob = await getGoogleWorkspaceValidationReviewAttachment(
        item.messageId,
        gmailMessageId,
        attachmentId,
      );
      const url = URL.createObjectURL(blob);
      if (blob.type === "application/octet-stream") {
        popup.close();
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.click();
      } else {
        popup.location.href = url;
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      popup.close();
      setThreadErrorByMessage((current) => ({
        ...current,
        [item.messageId]:
          caught instanceof Error ? caught.message : "Could not open this attachment.",
      }));
    } finally {
      setOpeningAttachmentKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  async function toggleThread(item: GoogleValidationReviewItem) {
    if (threadByMessage[item.messageId]) {
      setThreadByMessage((current) => {
        const next = { ...current };
        delete next[item.messageId];
        return next;
      });
      return;
    }

    setOpeningMessageIds((current) => {
      const next = new Set(current);
      next.add(item.messageId);
      return next;
    });
    setThreadErrorByMessage((current) => ({ ...current, [item.messageId]: "" }));
    try {
      const thread = await getGoogleWorkspaceValidationReviewThread(item.messageId);
      setThreadByMessage((current) => ({ ...current, [item.messageId]: thread }));
    } catch (caught) {
      setThreadErrorByMessage((current) => ({
        ...current,
        [item.messageId]:
          caught instanceof Error ? caught.message : "Could not open this email.",
      }));
    } finally {
      setOpeningMessageIds((current) => {
        const next = new Set(current);
        next.delete(item.messageId);
        return next;
      });
    }
  }

  function updateQuery(messageId: string, query: string) {
    setSearchByMessage((current) => ({
      ...current,
      [messageId]: {
        query,
        results: current[messageId]?.results ?? [],
        searching: false,
      },
    }));
  }

  async function search(item: GoogleValidationReviewItem) {
    const current = searchByMessage[item.messageId] ?? {
      query: "",
      results: [],
      searching: false,
    };
    const query = current.query.trim();
    if (!query) return;
    setSearchByMessage((state) => ({
      ...state,
      [item.messageId]: { ...current, searching: true },
    }));
    try {
      const results = await searchGoogleReviewProfiles(query);
      setSearchByMessage((state) => ({
        ...state,
        [item.messageId]: { query, results, searching: false },
      }));
    } catch (caught) {
      setSearchByMessage((state) => ({
        ...state,
        [item.messageId]: { query, results: [], searching: false },
      }));
      setError(caught instanceof Error ? caught.message : "Could not search profiles.");
    }
  }

  if (loading) {
    return (
      <p className="text-sm text-slate-500">
        {checking ? "Checking Gmail…" : "Loading email review…"}
      </p>
    );
  }

  return (
    <section className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/20">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
            Needs Review
          </h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Assign uncertain business email to an existing profile, create a new profile for a new opportunity, or ignore it if it does not belong in the CRM.
          </p>
          {resolvedCount || ignoredCount ? (
            <p className="mt-1 text-xs text-slate-500">
              {resolvedCount} resolved · {ignoredCount} ignored
            </p>
          ) : null}
        </div>
        {checkGmailOnMount ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              className="button-secondary px-3 py-2 text-sm"
              disabled={
                checking ||
                cleanupLoading ||
                cleanupDeleting ||
                busyMessageId !== null ||
                retryingMutationId !== null
              }
              onClick={() => void checkEmails()}
              type="button"
            >
              {checking ? "Checking Gmail…" : "Check emails"}
            </button>
            <button
              className="button-secondary px-3 py-2 text-sm"
              disabled={cleanupLoading || cleanupDeleting || checking}
              onClick={() => void toggleLabelCleanup()}
              type="button"
            >
              {cleanupLoading
                ? "Checking labels…"
                : cleanupOpen
                  ? "Close label cleanup"
                  : "Clean up old labels"}
            </button>
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm font-semibold text-rose-700" role="alert">{error}</p> : null}
      {gmailStatus ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200" role="status">
          <span>{gmailStatus.message}</span>
          {gmailStatus.needsRetry && gmailStatus.mutationId ? (
            <button
              className="button-secondary px-3 py-1.5 text-sm"
              disabled={retryingMutationId === gmailStatus.mutationId}
              onClick={() => void retryGmail(gmailStatus.mutationId!)}
              type="button"
            >
              {retryingMutationId === gmailStatus.mutationId ? "Retrying…" : "Retry Gmail"}
            </button>
          ) : null}
        </div>
      ) : null}

      {cleanupOpen ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-700 dark:bg-slate-950/40">
          <div>
            <p className="font-semibold text-slate-900 dark:text-slate-100">
              Old Gmail profile labels
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Only labels that do not match a current CRM profile are shown.
              Deleting a label never deletes its emails.
            </p>
          </div>
          {cleanupLabels.length ? (
            <div className="grid max-h-64 gap-2 overflow-y-auto">
              {cleanupLabels.map((label) => (
                <label
                  className="flex items-start gap-2 rounded border border-slate-200 p-2 dark:border-slate-700"
                  key={label.id}
                >
                  <input
                    aria-label={label.name}
                    checked={selectedCleanupLabelIds.includes(label.id)}
                    className="mt-0.5"
                    onChange={() => toggleCleanupLabel(label.id)}
                    type="checkbox"
                  />
                  <span className="break-all">{label.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-slate-600 dark:text-slate-300">
              No old profile labels found.
            </p>
          )}
          {cleanupLabels.length ? (
            <div>
              <button
                className="button-secondary px-3 py-2 text-sm"
                disabled={
                  cleanupDeleting || selectedCleanupLabelIds.length === 0
                }
                onClick={() => void deleteSelectedCleanupLabels()}
                type="button"
              >
                {cleanupDeleting
                  ? "Deleting labels…"
                  : `Delete ${selectedCleanupLabelIds.length} selected label${selectedCleanupLabelIds.length === 1 ? "" : "s"}`}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {cleanupStatus ? (
        <p className="text-sm font-semibold text-emerald-700" role="status">
          {cleanupStatus}
        </p>
      ) : null}

      {pending.length === 0 ? (
        <p className="rounded-lg bg-white p-3 text-sm text-slate-600 dark:bg-slate-950/40 dark:text-slate-300">
          No unresolved email in this validation sample.
        </p>
      ) : (
        <div className="grid gap-3">
          {pending.map((item) => {
            const searchState = searchByMessage[item.messageId] ?? {
              query: "",
              results: [],
              searching: false,
            };
            const createState = createByMessage[item.messageId];
            const busy = busyMessageId === item.messageId;
            const thread = threadByMessage[item.messageId];
            const opening = openingMessageIds.has(item.messageId);
            const threadError = threadErrorByMessage[item.messageId];
            return (
              <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm dark:border-amber-900 dark:bg-slate-950/40" key={item.messageId}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-words font-semibold text-slate-900 dark:text-slate-100">
                      {item.subject || "(No subject)"}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500">
                      {item.from || "Unknown sender"}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {item.hasAttachments ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        Has attachment
                      </span>
                    ) : null}
                    <button
                      aria-expanded={Boolean(thread)}
                      aria-label={`${thread ? "Hide" : "View"} email: ${item.subject || "(No subject)"}`}
                      className="button-secondary inline-flex min-h-10 items-center gap-1.5 px-3 py-2 text-sm"
                      disabled={opening}
                      onClick={() => void toggleThread(item)}
                      type="button"
                    >
                      {opening ? "Opening…" : thread ? "Hide email" : "View email"}
                    </button>
                  </div>
                </div>

                {threadError ? (
                  <p className="mt-3 text-sm font-semibold text-rose-700" role="alert">
                    {threadError}
                  </p>
                ) : null}

                {thread ? (
                  <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-900/50">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                        Complete conversation · {thread.messages.length} message{thread.messages.length === 1 ? "" : "s"}
                      </p>
                      <a
                        aria-label="Open in Gmail"
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
                        <div className="flex min-w-0 flex-wrap justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                          <div className="min-w-0 flex-1">
                            <p className="break-all font-semibold text-slate-700 dark:text-slate-200">
                              {message.from || "Unknown sender"}
                            </p>
                            <p className="break-all">To: {message.to || "Unknown recipient"}</p>
                          </div>
                          <span className="max-w-full break-words">{message.date}</span>
                        </div>
                        <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800 dark:text-slate-100">
                          {message.bodyText || "(No readable text body)"}
                        </p>
                        {message.attachments.length ? (
                          <div className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-600 dark:border-slate-800 dark:text-slate-300">
                            {message.attachments.map((attachment) => {
                              const attachmentKey = `${message.id}:${attachment.attachmentId}`;
                              return (
                                <button
                                  aria-label={`Open attachment: ${attachment.filename}`}
                                  className="button-secondary flex min-h-10 w-full items-center justify-between gap-2 px-3 py-2 text-left"
                                  disabled={openingAttachmentKeys.has(attachmentKey)}
                                  key={attachmentKey}
                                  onClick={() => void openAttachment(
                                    item,
                                    message.id,
                                    attachment.attachmentId,
                                    attachment.filename,
                                  )}
                                  type="button"
                                >
                                  <span className="min-w-0 break-all">
                                    Attachment: {attachment.filename}
                                  </span>
                                  <span className="shrink-0">
                                    {openingAttachmentKeys.has(attachmentKey) ? "Opening…" : "Open"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                ) : null}

                {item.candidates.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                      Suggested profiles
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {item.candidates.map((candidate) => (
                        <button
                          aria-label={`Assign to ${candidate.name}`}
                          className="button-secondary px-3 py-1.5 text-sm"
                          disabled={busy}
                          key={candidate.id}
                          onClick={() => void assign(item, candidate.id)}
                          type="button"
                        >
                          {candidate.name}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <label className="sr-only" htmlFor={`profile-search-${item.messageId}`}>
                    Search profiles for {item.subject || "email"}
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <input
                      aria-label={`Search profiles for ${item.subject || "email"}`}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                      id={`profile-search-${item.messageId}`}
                      onChange={(event) => updateQuery(item.messageId, event.target.value)}
                      placeholder="Search another profile"
                      value={searchState.query}
                    />
                  </div>
                  <button
                    className="button-secondary px-3 py-2"
                    disabled={busy || searchState.searching || !searchState.query.trim()}
                    onClick={() => void search(item)}
                    type="button"
                  >
                    {searchState.searching ? "Searching…" : "Search profiles"}
                  </button>
                </div>

                {searchState.results.length > 0 ? (
                  <div className="mt-2 grid gap-1">
                    {searchState.results.map((profile) => (
                      <button
                        aria-label={`Assign to ${profile.name}`}
                        className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900"
                        disabled={busy}
                        key={profile.id}
                        onClick={() => void assign(item, profile.id)}
                        type="button"
                      >
                        <span className="font-semibold">{profile.name}</span>
                        <span className="text-xs text-slate-500">
                          {[profile.city, profile.region].filter(Boolean).join(", ")}
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="mt-3">
                  <button
                    className="text-sm font-semibold text-orange-700 hover:underline disabled:opacity-50 dark:text-orange-300"
                    disabled={busy}
                    onClick={() => toggleCreate(item)}
                    type="button"
                  >
                    {createState?.open ? "Cancel new profile" : "Create new profile"}
                  </button>
                </div>

                {createState?.open ? (
                  <div className="mt-3 grid gap-3 rounded-lg border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900 dark:bg-orange-950/20">
                    <p className="text-xs text-slate-600 dark:text-slate-300">
                      Create a new lead/profile for this opportunity, then attach this email thread to it. Review the prefilled values before saving.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200 sm:col-span-2">
                        New profile name
                        <input
                          aria-label="New profile name"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          onChange={(event) => updateCreate(item.messageId, "profileName", event.target.value)}
                          value={createState.profileName}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        City
                        <input
                          aria-label="New profile city"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          onChange={(event) => updateCreate(item.messageId, "city", event.target.value)}
                          value={createState.city}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        State
                        <input
                          aria-label="New profile state"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm uppercase dark:border-slate-700 dark:bg-slate-950"
                          maxLength={2}
                          onChange={(event) => updateCreate(item.messageId, "region", event.target.value)}
                          value={createState.region}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Contact name
                        <input
                          aria-label="Contact name"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          onChange={(event) => updateCreate(item.messageId, "contactName", event.target.value)}
                          value={createState.contactName}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Contact email
                        <input
                          aria-label="Contact email"
                          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                          onChange={(event) => updateCreate(item.messageId, "contactEmail", event.target.value)}
                          type="email"
                          value={createState.contactEmail}
                        />
                      </label>
                    </div>
                    <div>
                      <button
                        className="button-primary px-3 py-2 text-sm"
                        disabled={busy || !createState.profileName.trim()}
                        onClick={() => void createNewProfile(item)}
                        type="button"
                      >
                        {busy ? "Creating…" : "Create profile and attach email"}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="mt-4 flex justify-end border-t border-slate-100 pt-3 dark:border-slate-800">
                  <button
                    className="text-sm font-semibold text-slate-600 hover:text-rose-700 disabled:opacity-50 dark:text-slate-300"
                    disabled={busy}
                    onClick={() => void ignore(item)}
                    type="button"
                  >
                    Ignore this email
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {showHistory && history.length > 0 ? (
        <div className="border-t border-amber-200 pt-3 dark:border-amber-900">
          <button
            aria-expanded={historyOpen}
            className="text-sm font-semibold text-orange-700 hover:underline dark:text-orange-300"
            onClick={() => setHistoryOpen((current) => !current)}
            type="button"
          >
            {historyOpen ? "Hide review history" : "Show review history"}
          </button>
          {historyOpen ? (
            <div className="mt-3 grid gap-2">
              {history.map((item) => (
                <article className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-950/40" key={item.messageId}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-900 dark:text-slate-100">{item.subject || "(No subject)"}</p>
                      <p className="mt-1 text-xs text-slate-500">{item.from || "Unknown sender"}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                        {item.state === "ignored"
                          ? "Ignored · Gmail unchanged"
                          : item.gmailSyncState === "completed"
                            ? "Assigned · archived in Gmail"
                            : item.gmailSyncErrorCode ===
                                "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"
                              ? "Assigned · reconnect Gmail"
                              : item.gmailSyncState === "retryable_error"
                                ? "Assigned · Gmail retry needed"
                              : item.gmailSyncState === "conflict"
                                ? "Assigned · label conflict"
                                : "Assigned"}
                      </span>
                      {item.gmailSyncState === "retryable_error" &&
                      item.gmailSyncMutationId ? (
                        <button
                          className="button-secondary px-2 py-1 text-xs"
                          disabled={retryingMutationId === item.gmailSyncMutationId}
                          onClick={() => void retryGmail(item.gmailSyncMutationId!)}
                          type="button"
                        >
                          {retryingMutationId === item.gmailSyncMutationId
                            ? "Retrying…"
                            : "Retry Gmail"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
