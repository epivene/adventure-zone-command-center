import {
  ScreenshotPicker,
  SavedScreenshot,
  type PendingScreenshot,
} from "@/components/assistant-workspace/ScreenshotAttachments";
import { uploadScreenshot } from "@/features/assistant-workspace/screenshots";
import {
  SetupPanel,
  type WorkspaceStatus,
} from "@/components/assistant-workspace/SetupPanel";
import { CampaignPanel } from "@/components/assistant-workspace/CampaignPanel";
import { ConversationContext } from "@/components/assistant-workspace/ConversationContext";
import { DocumentResults } from "@/components/assistant-workspace/DocumentResults";
import { businessDocumentsApi } from "@/lib/business-documents-api";
import type { HumanConfirmation } from "@/components/assistant-workspace/ActionResults";
import { SendReview } from "@/components/assistant-workspace/SendReview";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation } from "wouter";
import { Bot, Send, Square, BookOpen, MessageSquare } from "lucide-react";
import {
  workspaceApi,
  lastConversationKey,
} from "@/features/assistant-workspace/api";
import type {
  Conversation,
  ConversationLifecycle,
  ConversationListItem,
  Draft,
} from "@/features/assistant-workspace/types";
import { ActionResults } from "@/components/assistant-workspace/ActionResults";
import {
  DraftPreview,
  type DraftEdits,
} from "@/components/assistant-workspace/DraftPreview";
import { ConversationHistory } from "@/components/assistant-workspace/ConversationHistory";
import { KnowledgePanel } from "@/components/assistant-workspace/KnowledgePanel";
import { WorkspacePanel } from "@/components/assistant-workspace/WorkspacePanel";
import { AssistantMessage } from "@/components/assistant-workspace/AssistantMessage";
import { UsageCostSummary } from "@/components/assistant-workspace/UsageCost";
import { OfflinePreparation } from "@/components/assistant-workspace/OfflinePreparation";
import { useWorkspaceLayout } from "@/features/assistant-workspace/useWorkspaceLayout";
import {
  modelHelp,
  modelLabel,
} from "@/features/assistant-workspace/model-labels";
const buttonStyle =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 font-medium hover:bg-slate-50 disabled:opacity-50";
function friendly(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (/SCREENSHOT_SIZE/.test(code))
    return "Each screenshot must be 5 MB or smaller.";
  if (/SCREENSHOT_INVALID/.test(code))
    return "Choose a valid, still PNG, JPEG or WebP image.";
  if (/SCREENSHOT_UPLOAD/.test(code))
    return "The screenshot could not upload. Your message and images are still here; try sending again.";
  if (/SCREENSHOT_READ|SCREENSHOT_NOT_FOUND/.test(code))
    return "A saved screenshot could not be read. Try attaching it again.";
  if (/CONVERSATION_BUSY/.test(code))
    return "This conversation is running or needs its result checked. Finish or check the action before moving it.";
  if (/CONVERSATION_INACTIVE/.test(code))
    return "Restore this conversation before making changes.";
  if (/STATE_CHANGED|CONFLICT|CHANGED/.test(code))
    return "The saved information changed. Review the latest version and try again.";
  if (/STARTUP/.test(code))
    return "Assistant startup is incomplete. Refresh setup status for details.";
  if (/CONFIGURATION|DISABLED|MODEL/.test(code))
    return "The assistant needs its OpenAI connection configured.";
  if (/APPROVAL/.test(code))
    return "Review and approve the prepared action first.";
  if (/CONNECTION|GOOGLE|GMAIL/.test(code))
    return "Check your Google connection in Settings, then try again.";
  if (/RATE_LIMIT/.test(code))
    return "A few requests are still running. Please try again shortly.";
  return "This request could not finish. Your saved conversation is still available.";
}
function commercialActionSummary(kind: string, raw: unknown) {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;
  const money = (value: unknown) =>
    typeof value === "number"
      ? new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(value / 100)
      : "Unknown";
  if (kind === "record_invoice_payment")
    return `Record ${money(a.amountCents)} received ${a.receivedDate} by ${a.method}.\nReference: ${a.receiptReference} · Event year ${a.eventYear}`;
  if (kind === "register_invoice")
    return `Create draft invoice ${a.invoiceNumber}: ${money(a.totalCents)} total, ${money(a.depositCents)} deposit. Event year ${a.eventYear}.`;
  if (kind === "confirm_signed_contract")
    return `Confirm the reviewed signed file for event year ${a.eventYear}.\nReview: ${a.reviewNote}`;
  return undefined;
}
export default function AssistantWorkspacePage({
  conversationId,
}: {
  conversationId?: string;
}) {
  const [, navigate] = useLocation();
  const { focused, setFocused, historyInline, resultsInline } =
    useWorkspaceLayout();
  const button = `${buttonStyle} ${focused ? "min-h-[48px] text-[16px]" : "min-h-11 text-sm"}`;
  const [status, setStatus] = useState<WorkspaceStatus | null>(null),
    [list, setList] = useState<ConversationListItem[]>([]),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [model, setModel] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"chat" | "knowledge">("chat"),
    [progress, setProgress] = useState("");
  const [historyView, setHistoryView] =
    useState<ConversationLifecycle>("active");
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [knowledgeDirty, setKnowledgeDirty] = useState(false);
  const [initialNote, setInitialNote] = useState<{
    id: string;
    text: string;
    sourceLabel: string;
  }>();
  const lifecycleWrite = useRef(false);
  const [setupError, setSetupError] = useState("");
  const [setupRevision, setSetupRevision] = useState(0);
  const [refreshingSetup, setRefreshingSetup] = useState(false);
  const [sendDraft, setSendDraft] = useState<Draft | null>(null);
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<"history" | "results" | null>(
    null,
  );
  const historyOpen = openPanel === "history";
  const resultsOpen = openPanel === "results";
  const setHistoryOpen = useCallback((open: boolean) => {
    setOpenPanel((current) =>
      open ? "history" : current === "history" ? null : current,
    );
  }, []);
  const setResultsOpen = useCallback((open: boolean) => {
    setOpenPanel((current) =>
      open ? "results" : current === "results" ? null : current,
    );
  }, []);
  useEffect(() => {
    // An active editor stays visible when a rail becomes a sheet. Its children
    // remain mounted whether the user subsequently closes that sheet or not.
    if (!resultsInline && editingDraftId) setOpenPanel("results");
  }, [resultsInline, editingDraftId]);
  const composer = useRef<HTMLTextAreaElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  const requestRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const [files, setFiles] = useState<PendingScreenshot[]>([]);
  const filesRef = useRef<PendingScreenshot[]>([]);
  const pendingConversation = useRef<string | undefined>(undefined);
  const submission = useRef<AbortController | null>(null);
  const composerSession = useRef(0);
  function clearFiles() {
    for (const f of filesRef.current) URL.revokeObjectURL(f.url);
    filesRef.current = [];
    setFiles([]);
  }
  function addFiles(incoming: File[]) {
    if (busy || active || readOnly || !incoming.length) return;
    if (filesRef.current.length + incoming.length > 4) {
      setError("Attach up to four screenshots per message.");
      return;
    }
    if (
      incoming.some(
        (f) => !["image/png", "image/jpeg", "image/webp"].includes(f.type),
      )
    ) {
      setError("Choose PNG, JPEG or WebP screenshots.");
      return;
    }
    if (incoming.some((f) => !f.size || f.size > 5 * 1024 * 1024)) {
      setError("Each screenshot must be between 1 byte and 5 MB.");
      return;
    }
    setError("");
    filesRef.current = [
      ...filesRef.current,
      ...incoming.map((file) => ({
        id: crypto.randomUUID(),
        file,
        url: URL.createObjectURL(file),
      })),
    ];
    setFiles(filesRef.current);
  }
  function removeFile(id: string) {
    const removed = filesRef.current.find((f) => f.id === id);
    if (removed) URL.revokeObjectURL(removed.url);
    filesRef.current = filesRef.current.filter((f) => f.id !== id);
    setFiles(filesRef.current);
  }
  useEffect(
    () => () => {
      composerSession.current++;
      submission.current?.abort();
      for (const f of filesRef.current) URL.revokeObjectURL(f.url);
    },
    [],
  );
  const modelConversation = useRef<string | undefined>(undefined);
  const currentId = useRef(conversationId);
  const draftWriteVersion = useRef(0);
  currentId.current = conversationId;
  const refresh = useCallback(async () => {
    if (!conversationId) return;
    const version = draftWriteVersion.current;
    const c = await workspaceApi<Conversation>(
      `/conversations/${conversationId}`,
    );
    if (
      currentId.current === conversationId &&
      version === draftWriteVersion.current
    ) {
      setConversation(c);
      // Restore the saved model only when entering a conversation. Polling must
      // not overwrite an explicit model choice for the next message.
      if (modelConversation.current !== conversationId) {
        modelConversation.current = conversationId;
        setModel(c.selectedModel ?? "");
      }
    }
  }, [conversationId]);
  useEffect(() => {
    let live = true;
    setRefreshingSetup(true);
    setSetupError("");
    void workspaceApi<WorkspaceStatus>("/status")
      .then(async (s) => {
        if (!live) return;
        setStatus(s);
        setModel((current) =>
          modelConversation.current ? current : (s.model ?? ""),
        );
      })
      .catch((e) => {
        if (live) {
          setStatus(null);
          setSetupError(
            "Setup status could not be loaded. Refresh to try again.",
          );
        }
      })
      .finally(() => {
        if (live) setRefreshingSetup(false);
      });
    return () => {
      live = false;
    };
  }, [setupRevision]);
  useEffect(() => {
    if (!status?.ready) return;
    let live = true;
    setHistoryLoading(true);
    setList([]);
    void workspaceApi<ConversationListItem[]>(
      `/conversations?lifecycle=${historyView}`,
    )
      .then((items) => {
        if (live) setList(items);
      })
      .catch((e) => {
        if (live) setError(friendly(e));
      })
      .finally(() => {
        if (live) setHistoryLoading(false);
      });
    return () => {
      live = false;
    };
  }, [status?.ready, historyView, historyRevision]);
  useEffect(() => {
    modelConversation.current = undefined;
    setConversation(null);
    followMessages.current = true;
    setEditingDraftId(null);
    setSendDraft(null);
    setHistoryOpen(false);
    setResultsOpen(false);
    setText("");
    setError("");
    requestRef.current = null;
    composerSession.current++;
    submission.current?.abort();
    submission.current = null;
    pendingConversation.current = undefined;
    clearFiles();
    setBusy(false);
    setProgress("");
  }, [conversationId]);
  useEffect(() => {
    if (conversationId && status?.ready) {
      void refresh().catch((e) => setError(friendly(e)));
    }
  }, [conversationId, refresh, status?.ready]);
  useEffect(() => {
    if (!conversation || conversation.id !== conversationId) return;
    if ((conversation.lifecycle ?? "active") === "active")
      localStorage.setItem(lastConversationKey, conversation.id);
    else if (localStorage.getItem(lastConversationKey) === conversation.id)
      localStorage.removeItem(lastConversationKey);
  }, [conversation?.id, conversation?.lifecycle, conversationId]);
  useLayoutEffect(() => {
    const node = messageList.current;
    if (node && followMessages.current) node.scrollTop = node.scrollHeight;
  }, [conversation?.id, conversation?.messages.length, progress]);
  const active = conversation?.runs.find((r) =>
    ["queued", "running"].includes(r.status),
  );
  const readOnly =
    !!conversation && (conversation.lifecycle ?? "active") !== "active";
  const writesDisabled =
    busy || readOnly || (!!conversationId && !conversation);
  function canLeave() {
    if (busy || lifecycleWrite.current) return false;
    if (editingDraftId || knowledgeDirty) {
      setError("Save or cancel your edits before leaving this view.");
      return false;
    }
    return (
      (!text.trim() && !filesRef.current.length) ||
      window.confirm("Discard your unsent message and screenshots?")
    );
  }
  async function moveConversation(
    item: ConversationListItem,
    lifecycle: ConversationLifecycle,
  ) {
    if (busy || lifecycleWrite.current) return;
    if (item.id === conversationId && !canLeave()) return;
    if (
      lifecycle === "trashed" &&
      !window.confirm(
        `Move “${item.title}” to Trash? You can restore it later. Saved information and offline copies are kept separately.`,
      )
    )
      return;
    lifecycleWrite.current = true;
    draftWriteVersion.current++;
    setBusy(true);
    setError("");
    try {
      const saved = await workspaceApi<ConversationListItem>(
        `/conversations/${item.id}/lifecycle`,
        "PATCH",
        {
          version:
            item.id === conversation?.id ? conversation.version : item.version,
          lifecycle,
        },
      );
      draftWriteVersion.current++;
      setList((items) => items.filter((c) => c.id !== saved.id));
      setHistoryRevision((n) => n + 1);
      if (saved.id === currentId.current) {
        setConversation((current) =>
          current?.id === saved.id
            ? {
                ...current,
                lifecycle: saved.lifecycle ?? lifecycle,
                version: saved.version,
              }
            : current,
        );
        setSendDraft(null);
        setText("");
        clearFiles();
      }
      if (
        lifecycle !== "active" &&
        localStorage.getItem(lastConversationKey) === saved.id
      )
        localStorage.removeItem(lastConversationKey);
    } catch (e) {
      setError(friendly(e));
      setHistoryRevision((n) => n + 1);
      await refresh().catch(() => undefined);
    } finally {
      lifecycleWrite.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!active) return;
    let live = true;
    let after = 0;
    const timer = setInterval(() => {
      void (async () => {
        const events = await workspaceApi<
          {
            sequence: string | number;
            kind: string;
            payload: {
              name?: string;
              text?: string;
              status?: string;
              code?: string;
            };
          }[]
        >(`/runs/${active.id}/events?after=${after}`);
        if (!live) return;
        for (const e of events) {
          after = Number(e.sequence);
          if (e.kind === "tool")
            setProgress(
              `${e.payload.name?.replaceAll("_", " ")} · ${e.payload.status}`,
            );
          else if (
            e.kind === "error" &&
            e.payload.code !== "ASSISTANT_CANCELLED"
          )
            setError(friendly(new Error(e.payload.code)));
          else if (e.payload.text) setProgress(e.payload.text);
        }
        await refresh();
      })().catch(() => {
        if (live) setProgress("Reconnecting to saved progress…");
      });
    }, 1500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active?.id, refresh]);
  async function create() {
    if (!canLeave()) return null;
    setBusy(true);
    setError("");
    try {
      const c = await workspaceApi<Conversation>("/conversations", "POST", {
        title: "New conversation",
      });
      setHistoryView("active");
      setHistoryRevision((n) => n + 1);
      navigate(`/assistant/workspace/${c.id}`);
      return c.id;
    } catch (e) {
      setError(friendly(e));
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (editingDraftId) {
      setError(
        "Save or cancel your draft edits before asking the assistant to continue.",
      );
      return;
    }
    if (
      (!text.trim() && !filesRef.current.length) ||
      writesDisabled ||
      active ||
      submission.current
    )
      return;
    followMessages.current = true;
    const controller = new AbortController();
    submission.current = controller;
    const session = composerSession.current,
      body = text.trim(),
      attached = [...filesRef.current];
    const stillHere = () =>
      composerSession.current === session && !controller.signal.aborted;
    setBusy(true);
    setError("");
    try {
      let id = conversationId ?? pendingConversation.current;
      if (!id) {
        const c = await workspaceApi<Conversation>(
          "/conversations",
          "POST",
          {
            title:
              body.slice(0, 80) ||
              attached[0]?.file.name.slice(0, 80) ||
              "Screenshots",
          },
          controller.signal,
        );
        if (!stillHere()) return;
        id = c.id;
        pendingConversation.current = id;
        setHistoryView("active");
        setHistoryRevision((n) => n + 1);
      }
      const fingerprint = JSON.stringify({
        conversationId: id,
        text: body,
        attachments: attached.map((f) => f.id),
        model,
      });
      const req =
        requestRef.current?.fingerprint === fingerprint
          ? requestRef.current
          : { fingerprint, key: crypto.randomUUID() };
      requestRef.current = req;
      for (const f of attached) {
        if (!stillHere()) return;
        if (f.uploadedTo !== id) {
          await uploadScreenshot(id, f.id, f.file, controller.signal);
          f.uploadedTo = id;
        }
      }
      if (!stillHere()) return;
      await workspaceApi(
        `/conversations/${id}/messages`,
        "POST",
        {
          text: body,
          requestKey: req.key,
          model,
          ...(attached.length
            ? { attachmentIds: attached.map((f) => f.id) }
            : {}),
        },
        controller.signal,
      );
      if (!stillHere()) return;
      setText("");
      clearFiles();
      requestRef.current = null;
      pendingConversation.current = undefined;
      if (id === conversationId) await refresh();
      else navigate(`/assistant/workspace/${id}`);
    } catch (e) {
      if (stillHere()) setError(friendly(e));
    } finally {
      if (stillHere()) {
        setBusy(false);
        submission.current = null;
      }
    }
  }
  async function action(id: string, confirmation?: HumanConfirmation) {
    if (writesDisabled) return;
    const saved = conversation?.actions.find((a) => a.id === id);
    if (!saved) return;
    setBusy(true);
    setError("");
    try {
      await workspaceApi(`/actions/${id}/execute`, "POST", {
        revision: saved.expectedRevision,
        ...(confirmation ? { confirmation } : {}),
        requestKey: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function openDocument(id: string) {
    const tab = window.open("about:blank", "_blank");
    if (tab) tab.opener = null;
    try {
      const url = await businessDocumentsApi.open(id);
      if (new URL(url, window.location.origin).protocol !== "https:")
        throw new Error("ASSISTANT_DOCUMENT_UNAVAILABLE");
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch {
      tab?.close();
      setError(
        "This file could not be opened. Check the document in Business Documents.",
      );
    }
  }
  async function editDraft(draft: Draft, changes: DraftEdits) {
    if (writesDisabled) throw new Error("ASSISTANT_CONVERSATION_INACTIVE");
    const id = conversationId;
    draftWriteVersion.current++;
    // Use the draft returned by PATCH immediately. A later conversation refresh
    // is not part of saving: its failure must not invite a duplicate edit.
    setBusy(true);
    try {
      const saved = await workspaceApi<Draft>(`/drafts/${draft.id}`, "PATCH", {
        revision: draft.revision,
        ...changes,
      });
      draftWriteVersion.current++;
      if (currentId.current === id) {
        setConversation((current) =>
          current && current.id === id
            ? {
                ...current,
                drafts: current.drafts.map((item) =>
                  item.id === saved.id ? saved : item,
                ),
              }
            : current,
        );
        setSendDraft(null);
      }
    } catch (error) {
      draftWriteVersion.current++;
      if (currentId.current === id) await refresh().catch(() => undefined);
      throw error;
    } finally {
      if (currentId.current === id) setBusy(false);
    }
  }
  async function saveDraft(draft: Draft) {
    if (writesDisabled) return;
    setBusy(true);
    setError("");
    try {
      await workspaceApi(`/drafts/${draft.id}/save-gmail`, "POST", {
        revision: draft.revision,
        requestKey: crypto.randomUUID(),
      });
      await refresh();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={`mx-auto min-w-0 ${focused ? "max-w-4xl" : "max-w-[1600px]"}`}
    >
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-900 p-2 text-white">
            <Bot aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-950">
              Assistant workspace
            </h1>
            <p className="text-sm text-slate-600">
              Conversations, email and follow-through in one place.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`${button} aria-pressed:border-teal-700 aria-pressed:bg-teal-50`}
            aria-pressed={focused}
            onClick={() => {
              setOpenPanel(editingDraftId ? "results" : null);
              setFocused(!focused);
            }}
          >
            Focus chat
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              if (knowledgeDirty) {
                setError(
                  "Save or cancel your saved info edits before returning to chat.",
                );
                return;
              }
              setInitialNote(undefined);
              setTab("chat");
            }}
            aria-pressed={tab === "chat"}
          >
            <MessageSquare className="mr-1 inline h-4 w-4" />
            Chat
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setTab("knowledge")}
            disabled={!!editingDraftId}
            aria-pressed={tab === "knowledge"}
          >
            <BookOpen className="mr-1 inline h-4 w-4" />
            Saved info & rules
          </button>
        </div>
      </header>
      {(setupError || error) && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {setupError || error}
        </p>
      )}
      <OfflinePreparation
        conversation={conversation}
        busy={busy || !!active || !!editingDraftId}
      />
      {status && (
        <SetupPanel
          status={status}
          refreshing={refreshingSetup}
          onRefresh={() => setSetupRevision((n) => n + 1)}
        />
      )}
      {!status ? (
        setupError ? (
          <button
            type="button"
            className={button}
            disabled={refreshingSetup}
            onClick={() => setSetupRevision((n) => n + 1)}
          >
            Refresh setup status
          </button>
        ) : (
          <p role="status">Loading assistant…</p>
        )
      ) : !status.ready ? null : tab === "knowledge" ? (
        <KnowledgePanel
          selection={conversation?.selection}
          initialNote={initialNote}
          onDirtyChange={setKnowledgeDirty}
        />
      ) : (
        <>
          {(!historyInline || !resultsInline) && (
            <div
              className={`mx-auto mb-3 flex flex-wrap gap-2 ${resultsInline ? "max-w-none" : "max-w-4xl"}`}
            >
              {!historyInline && (
                <button
                  type="button"
                  className={button}
                  aria-haspopup="dialog"
                  aria-expanded={historyOpen}
                  onClick={() => setHistoryOpen(true)}
                >
                  Conversations
                </button>
              )}
              {!resultsInline && (
                <button
                  type="button"
                  className={button}
                  aria-haspopup="dialog"
                  aria-expanded={resultsOpen}
                  onClick={() => setResultsOpen(true)}
                >
                  Drafts and actions
                  {conversation
                    ? ` (${conversation.drafts.length + conversation.actions.length})`
                    : ""}
                </button>
              )}
            </div>
          )}
          <div
            className={`mx-auto grid min-w-0 gap-4 ${historyInline ? "max-w-none grid-cols-[220px_minmax(0,1fr)_360px]" : resultsInline ? "max-w-none grid-cols-[minmax(0,1fr)_360px]" : "max-w-4xl grid-cols-1"}`}
          >
            <WorkspacePanel
              title="Conversations"
              open={historyOpen}
              onOpenChange={setHistoryOpen}
              inline={historyInline}
              side="left"
            >
              <ConversationHistory
                items={list}
                view={historyView}
                selectedId={conversationId}
                busy={busy || !!editingDraftId}
                loading={historyLoading}
                button={button}
                onView={setHistoryView}
                onCreate={() => void create()}
                onOpen={(id) => {
                  if (id !== conversationId && !canLeave()) return;
                  setHistoryOpen(false);
                  navigate(`/assistant/workspace/${id}`);
                }}
                onMove={(item, lifecycle) =>
                  void moveConversation(item, lifecycle)
                }
              />
            </WorkspacePanel>
            <section className="flex h-[calc(100dvh-19rem)] min-h-[26rem] min-w-0 flex-col rounded-xl border bg-white md:h-[calc(100dvh-16rem)]">
              {readOnly && conversation && (
                <div className="border-b bg-amber-50 p-3 text-sm">
                  <p>
                    This conversation is{" "}
                    {conversation.lifecycle === "trashed"
                      ? "in Trash"
                      : "archived"}
                    . Restore it to send messages or change drafts and actions.
                  </p>
                  <p className="mt-1 text-xs">
                    Saved information and offline copies are managed separately.
                  </p>
                  <button
                    className={`${button} mt-2`}
                    disabled={busy}
                    onClick={() =>
                      void moveConversation(conversation, "active")
                    }
                  >
                    Restore conversation
                  </button>
                </div>
              )}
              <div className="border-b p-4">
                <label className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  Model{" "}
                  <select
                    className={`${focused ? "min-h-[48px]" : "min-h-11"} min-w-0 max-w-full flex-1 rounded border bg-white px-2 text-[16px] sm:flex-none`}
                    aria-describedby="workspace-model-help"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    disabled={writesDisabled || !!active}
                  >
                    {status.models.map((m) => (
                      <option key={m} value={m}>
                        {modelLabel(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <p
                  id="workspace-model-help"
                  className="mt-1 text-sm text-slate-500"
                >
                  {modelHelp(model || status.model || "")}
                </p>
                <p className="mt-2 text-xs text-slate-500">
                  {conversation?.selection.organizationIds.length
                    ? `${conversation.selection.organizationIds.length} selected profile(s)${conversation.selection.eventYear ? ` · ${conversation.selection.eventYear}` : ""}`
                    : "Start by naming a profile or describing your task."}
                </p>
              </div>
              <div
                className="min-h-0 flex-1 space-y-5 overflow-auto overscroll-contain p-3 sm:p-4"
                aria-label="Conversation"
                ref={messageList}
                onScroll={(event) => {
                  const node = event.currentTarget;
                  followMessages.current =
                    node.scrollHeight - node.scrollTop - node.clientHeight < 80;
                }}
              >
                <ConversationContext summary={conversation?.summary} />
                {!readOnly && !conversation?.messages.length && (
                  <div className="py-10">
                    <h2 className="text-xl font-semibold">What needs doing?</h2>
                    <p className="mt-2 text-sm text-slate-600">
                      Review a customer’s email history, prepare a reply, update
                      a profile or plan your follow-ups.
                    </p>
                    <button
                      type="button"
                      className={`${button} mt-4`}
                      onClick={() => {
                        setText(
                          "Help me find a profile and review the full conversation before drafting a reply.",
                        );
                        composer.current?.focus();
                      }}
                    >
                      Review a customer conversation
                    </button>
                  </div>
                )}
                {conversation?.messages.map((m) => (
                  <article
                    key={m.id}
                    id={`message-${m.id}`}
                    className={`rounded-xl p-3 sm:p-4 ${m.role === "user" ? "ml-3 bg-slate-100 sm:ml-6" : "bg-teal-50/40 sm:mr-3"}`}
                  >
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {m.role === "user" ? "You" : "Assistant"}
                    </p>
                    {!!m.attachments?.length && conversation && (
                      <div className="flex flex-wrap gap-2">
                        {m.attachments.map((a) => (
                          <SavedScreenshot
                            key={a.id}
                            conversationId={conversation.id}
                            attachment={a}
                          />
                        ))}
                      </div>
                    )}
                    <div
                      className={`break-words ${focused ? "text-[18px] leading-8" : "text-base leading-7"}`}
                    >
                      {m.role === "assistant" ? (
                        <AssistantMessage text={m.text} />
                      ) : (
                        <p className="whitespace-pre-wrap">{m.text}</p>
                      )}
                    </div>
                    {m.text.trim() && (
                      <button
                        type="button"
                        className="mt-2 min-h-11 rounded-lg border px-3 py-2 text-sm text-teal-900 disabled:opacity-50"
                        disabled={busy || !!editingDraftId}
                        onClick={() => {
                          if (knowledgeDirty) {
                            setError(
                              "Save or cancel your saved info edits first.",
                            );
                            return;
                          }
                          setInitialNote({
                            id: m.id,
                            text: m.text,
                            sourceLabel: `Conversation: ${conversation.title}`,
                          });
                          setTab("knowledge");
                        }}
                      >
                        Remember this
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <div
                role="status"
                aria-live="polite"
                className="px-4 text-xs text-slate-500"
              >
                {active
                  ? progress || "Working…"
                  : conversation?.runs[0]
                    ? `${conversation.runs[0].usage.tokens.toLocaleString()} tokens · ${conversation.runs[0].usage.steps} steps`
                    : ""}
              </div>
              {!!conversation?.runs.length && (
                <UsageCostSummary
                  latest={conversation.runs[0]?.usage.cost}
                  conversation={conversation.usage?.cost}
                />
              )}
              {conversation?.runs[0]?.status === "failed" && (
                <p
                  role="alert"
                  className="mx-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
                >
                  The assistant could not complete this reply. Your message and
                  screenshots are saved. Send a follow-up to try again.
                </p>
              )}
              <form
                onSubmit={submit}
                className="shrink-0 space-y-2 border-t p-3 sm:p-4"
                onPaste={(e) => {
                  const images = Array.from(e.clipboardData.files);
                  if (images.length) {
                    e.preventDefault();
                    addFiles(images);
                  }
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  addFiles(Array.from(e.dataTransfer.files));
                }}
              >
                <ScreenshotPicker
                  files={files}
                  disabled={writesDisabled || !!active}
                  onAdd={addFiles}
                  onRemove={removeFile}
                />
                <label className="sr-only" htmlFor="workspace-message">
                  Message the assistant
                </label>
                <textarea
                  id="workspace-message"
                  ref={composer}
                  disabled={writesDisabled}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Ask a follow-up or describe what you want done…"
                  className="min-h-24 max-h-48 w-full resize-y rounded-xl border p-3 text-[16px] focus:outline-teal-700"
                />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs text-slate-500">
                    Email sending requires a separate review.
                  </span>
                  {active ? (
                    <button
                      type="button"
                      className={button}
                      onClick={() =>
                        void workspaceApi(
                          `/runs/${active.id}/cancel`,
                          "POST",
                          {},
                        )
                          .then(refresh)
                          .catch((e) => setError(friendly(e)))
                      }
                    >
                      <Square className="mr-1 inline h-3 w-3" />
                      Stop
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={
                        writesDisabled || (!text.trim() && !files.length)
                      }
                      className={`${focused ? "min-h-[48px] text-[16px]" : "min-h-11 text-sm"} rounded-lg bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50`}
                    >
                      <Send className="mr-2 inline h-4 w-4" />
                      Send message
                    </button>
                  )}
                </div>
              </form>
            </section>
            <WorkspacePanel
              title="Drafts and actions"
              open={resultsOpen}
              onOpenChange={setResultsOpen}
              inline={resultsInline}
            >
              <aside className="min-w-0 space-y-4">
                <CampaignPanel
                  batches={conversation?.campaigns ?? []}
                  reviews={conversation?.campaignReviews ?? []}
                  selectedBatchId={conversation?.selection.batchId ?? null}
                  busy={writesDisabled || !!active}
                  onRequest={(message) => {
                    if (writesDisabled) return;
                    setText(message);
                    setResultsOpen(false);
                    requestAnimationFrame(() => composer.current?.focus());
                  }}
                />
                <DocumentResults
                  items={conversation?.documentResults ?? []}
                  onOpen={(id) => void openDocument(id)}
                />
                <h2 className="font-semibold">Drafts and actions</h2>
                {!conversation?.drafts.length &&
                  !conversation?.actions.length && (
                    <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">
                      Prepared drafts and verified action results will appear
                      here.
                    </p>
                  )}
                {conversation?.drafts.map((d) => (
                  <DraftPreview
                    key={d.id}
                    draft={d}
                    busy={
                      writesDisabled ||
                      !!active ||
                      (!!editingDraftId && editingDraftId !== d.id)
                    }
                    onEdit={editDraft}
                    onEditingChange={(editing) => {
                      setEditingDraftId(editing ? d.id : null);
                      setSendDraft(null);
                    }}
                    onRevise={() => {
                      if (writesDisabled) return;
                      setText(`Revise draft ${d.id}: `);
                      setResultsOpen(false);
                      requestAnimationFrame(() => composer.current?.focus());
                    }}
                    onSave={() => void saveDraft(d)}
                    onReviewSend={() => {
                      if (!writesDisabled) setSendDraft(d);
                    }}
                  />
                ))}
                {sendDraft && !readOnly && (
                  <SendReview
                    draft={sendDraft}
                    onClose={() => setSendDraft(null)}
                    onChanged={refresh}
                  />
                )}
                <ActionResults
                  busy={writesDisabled || !!editingDraftId}
                  items={
                    conversation?.actions.map((a) => ({
                      id: a.id,
                      label: a.preview?.title ?? a.kind.replaceAll("_", " "),
                      targetId: a.targetId,
                      revision: a.expectedRevision,
                      approvalBlocked: a.preview?.available === false,
                      status: a.status,
                      href: a.result?.receipts?.[0]?.href ?? null,
                      details: a.arguments,
                      confirmation:
                        a.kind === "record_invoice_payment"
                          ? ("payment_received" as const)
                          : a.kind === "confirm_signed_contract"
                            ? ("signatures_reviewed" as const)
                            : undefined,
                      summary: [
                        a.preview?.summary,
                        commercialActionSummary(a.kind, a.arguments),
                      ]
                        .filter(Boolean)
                        .join("\n"),
                      reviewHref:
                        a.preview?.reviewHref ??
                        (a.kind === "confirm_signed_contract"
                          ? `/contracts/${a.targetId}/handoff`
                          : undefined),
                      trackingRepair:
                        a.result?.code === "ASSISTANT_TRACKING_REPAIR_REQUIRED",
                    })) ?? []
                  }
                  onApprove={(id, confirmation) =>
                    void action(id, confirmation)
                  }
                  onCheck={(id) => void action(id)}
                />
              </aside>
            </WorkspacePanel>
          </div>
        </>
      )}
    </div>
  );
}
