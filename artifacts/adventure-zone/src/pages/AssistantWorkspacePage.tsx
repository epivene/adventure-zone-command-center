import { CampaignPanel } from "@/components/assistant-workspace/CampaignPanel";
import { ConversationContext } from "@/components/assistant-workspace/ConversationContext";
import { DocumentResults } from "@/components/assistant-workspace/DocumentResults";
import { businessDocumentsApi } from "@/lib/business-documents-api";
import type { HumanConfirmation } from "@/components/assistant-workspace/ActionResults";
import { SendReview } from "@/components/assistant-workspace/SendReview";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation } from "wouter";
import { Bot, Plus, Send, Square, BookOpen, MessageSquare } from "lucide-react";
import {
  workspaceApi,
  lastConversationKey,
} from "@/features/assistant-workspace/api";
import type { Conversation, Draft } from "@/features/assistant-workspace/types";
import { ActionResults } from "@/components/assistant-workspace/ActionResults";
import { DraftPreview } from "@/components/assistant-workspace/DraftPreview";
import { KnowledgePanel } from "@/components/assistant-workspace/KnowledgePanel";
const button =
  "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50";
function friendly(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (/STATE_CHANGED|CONFLICT|CHANGED/.test(code))
    return "The saved information changed. Review the latest version and try again.";
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
  const [status, setStatus] = useState<{
      enabled: boolean;
      model: string | null;
      models: string[];
    } | null>(null),
    [list, setList] = useState<{ id: string; title: string }[]>([]),
    [conversation, setConversation] = useState<Conversation | null>(null),
    [text, setText] = useState(""),
    [model, setModel] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [tab, setTab] = useState<"chat" | "knowledge">("chat"),
    [progress, setProgress] = useState("");
  const [sendDraft, setSendDraft] = useState<Draft | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const requestRef = useRef<{ text: string; key: string } | null>(null);
  const modelConversation = useRef<string | undefined>(undefined);
  const currentId = useRef(conversationId);
  currentId.current = conversationId;
  const refresh = useCallback(async () => {
    if (!conversationId) return;
    const c = await workspaceApi<Conversation>(
      `/conversations/${conversationId}`,
    );
    if (currentId.current === conversationId) {
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
    void workspaceApi<{
      enabled: boolean;
      model: string | null;
      models: string[];
    }>("/status")
      .then(async (s) => {
        if (!live) return;
        setStatus(s);
        setModel((current) =>
          modelConversation.current ? current : (s.model ?? ""),
        );
        if (s.enabled) {
          const items =
            await workspaceApi<{ id: string; title: string }[]>(
              "/conversations",
            );
          if (live) setList(items);
        }
      })
      .catch((e) => {
        if (live) setError(friendly(e));
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    modelConversation.current = undefined;
    setConversation(null);
    setSendDraft(null);
    setText("");
    setError("");
    requestRef.current = null;
    setProgress("");
    if (conversationId) {
      localStorage.setItem(lastConversationKey, conversationId);
      void refresh().catch((e) => setError(friendly(e)));
    }
  }, [conversationId, refresh]);
  const active = conversation?.runs.find((r) =>
    ["queued", "running"].includes(r.status),
  );
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
            payload: { name?: string; text?: string; status?: string };
          }[]
        >(`/runs/${active.id}/events?after=${after}`);
        if (!live) return;
        for (const e of events) {
          after = Number(e.sequence);
          if (e.kind === "tool")
            setProgress(
              `${e.payload.name?.replaceAll("_", " ")} · ${e.payload.status}`,
            );
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
    setBusy(true);
    setError("");
    try {
      const c = await workspaceApi<Conversation>("/conversations", "POST", {
        title: "New conversation",
      });
      setList((items) => [{ id: c.id, title: c.title }, ...items]);
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
    if (!text.trim() || busy || active) return;
    setBusy(true);
    setError("");
    const body = text.trim();
    try {
      let id = conversationId;
      if (!id) {
        const c = await workspaceApi<Conversation>("/conversations", "POST", {
          title: body.slice(0, 80),
        });
        id = c.id;
        setList((items) => [{ id: c.id, title: c.title }, ...items]);
      }
      const req =
        requestRef.current?.text === body
          ? requestRef.current
          : { text: body, key: crypto.randomUUID() };
      requestRef.current = req;
      await workspaceApi(`/conversations/${id}/messages`, "POST", {
        text: body,
        requestKey: req.key,
        model,
      });
      setText("");
      requestRef.current = null;
      if (id === conversationId) await refresh();
      else navigate(`/assistant/workspace/${id}`);
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }
  async function action(id: string, confirmation?: HumanConfirmation) {
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
  async function saveDraft(draft: Draft) {
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
    <main className="mx-auto max-w-[1500px] p-3 sm:p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-teal-900 p-3 text-white">
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
        <div className="flex gap-2">
          <button
            type="button"
            className={button}
            onClick={() => setTab("chat")}
            aria-pressed={tab === "chat"}
          >
            <MessageSquare className="mr-1 inline h-4 w-4" />
            Chat
          </button>
          <button
            type="button"
            className={button}
            onClick={() => setTab("knowledge")}
            aria-pressed={tab === "knowledge"}
          >
            <BookOpen className="mr-1 inline h-4 w-4" />
            Business rules
          </button>
        </div>
      </header>
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {status && !status.enabled ? (
        <section className="rounded-2xl border bg-white p-6">
          <h2 className="font-semibold">Connect the assistant</h2>
          <p className="mt-2 text-sm text-slate-600">
            The new workspace is waiting for its OpenAI connection and owner
            access to be enabled. Your existing assistant remains available.
          </p>
          <a
            href="/settings"
            className="mt-4 inline-block text-teal-800 underline"
          >
            Open settings
          </a>
        </section>
      ) : !status ? (
        <p role="status">Loading assistant…</p>
      ) : tab === "knowledge" ? (
        <KnowledgePanel />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_340px]">
          <aside className="rounded-xl border bg-white p-3">
            <button
              type="button"
              className={`${button} w-full`}
              onClick={() => void create()}
              disabled={busy}
            >
              <Plus className="mr-1 inline h-4 w-4" />
              New conversation
            </button>
            <nav
              aria-label="Saved conversations"
              className="mt-3 flex max-h-60 gap-2 overflow-auto lg:max-h-[65vh] lg:flex-col"
            >
              {list.map((c) => (
                <a
                  key={c.id}
                  href={`/assistant/workspace/${c.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/assistant/workspace/${c.id}`);
                  }}
                  aria-current={conversationId === c.id ? "page" : undefined}
                  className={`min-w-32 rounded-lg p-3 text-sm ${conversationId === c.id ? "bg-teal-50 font-semibold text-teal-900" : "hover:bg-slate-50"}`}
                >
                  {c.title}
                </a>
              ))}
            </nav>
          </aside>
          <section className="flex min-h-[65vh] min-w-0 flex-col rounded-xl border bg-white">
            <div className="border-b p-4">
              <label className="text-xs text-slate-600">
                Model{" "}
                <select
                  className="ml-2 rounded border p-1 text-sm"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  disabled={!!active}
                >
                  {status.models.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-xs text-slate-500">
                {conversation?.selection.organizationIds.length
                  ? `${conversation.selection.organizationIds.length} selected profile(s)${conversation.selection.eventYear ? ` · ${conversation.selection.eventYear}` : ""}`
                  : "Start by naming a profile or describing your task."}
              </p>
            </div>
            <ConversationContext summary={conversation?.summary} />
            <div
              className="flex-1 space-y-5 overflow-auto p-4"
              aria-label="Conversation"
            >
              {!conversation?.messages.length && (
                <div className="py-10">
                  <h2 className="text-xl font-semibold">What needs doing?</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Review a customer’s email history, prepare a reply, update a
                    profile or plan your follow-ups.
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
                  className={`rounded-xl p-4 ${m.role === "user" ? "ml-6 bg-slate-100" : "mr-3 bg-teal-50/40"}`}
                >
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {m.role === "user" ? "You" : "Assistant"}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {m.text}
                  </p>
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
            <form onSubmit={submit} className="space-y-2 border-t p-4">
              <label className="sr-only" htmlFor="workspace-message">
                Message the assistant
              </label>
              <textarea
                id="workspace-message"
                ref={composer}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Ask a follow-up or describe what you want done…"
                className="min-h-24 w-full resize-y rounded-xl border p-3 text-sm focus:outline-teal-700"
              />
              <div className="flex justify-between gap-3">
                <span className="text-xs text-slate-500">
                  Email sending requires a separate review.
                </span>
                {active ? (
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      void workspaceApi(`/runs/${active.id}/cancel`, "POST", {})
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
                    disabled={busy || !text.trim()}
                    className="rounded-lg bg-teal-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    <Send className="mr-2 inline h-4 w-4" />
                    Send message
                  </button>
                )}
              </div>
            </form>
          </section>
          <aside className="space-y-4">
            <CampaignPanel
              batches={conversation?.campaigns ?? []}
              reviews={conversation?.campaignReviews ?? []}
              selectedBatchId={conversation?.selection.batchId ?? null}
              busy={busy || !!active}
              onRequest={(message) => {
                setText(message);
                composer.current?.focus();
              }}
            />
            <DocumentResults
              items={conversation?.documentResults ?? []}
              onOpen={(id) => void openDocument(id)}
            />
            <h2 className="font-semibold">Drafts and actions</h2>
            {!conversation?.drafts.length && !conversation?.actions.length && (
              <p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">
                Prepared drafts and verified action results will appear here.
              </p>
            )}
            {conversation?.drafts.map((d) => (
              <DraftPreview
                key={`${d.id}:${d.revision}`}
                draft={d}
                busy={busy}
                onRevise={() => {
                  setText(`Revise draft ${d.id}: `);
                  composer.current?.focus();
                }}
                onSave={() => void saveDraft(d)}
                onReviewSend={() => setSendDraft(d)}
              />
            ))}
            {sendDraft && (
              <SendReview
                draft={sendDraft}
                onClose={() => setSendDraft(null)}
                onChanged={refresh}
              />
            )}
            <ActionResults
              busy={busy}
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
              onApprove={(id, confirmation) => void action(id, confirmation)}
              onCheck={(id) => void action(id)}
            />
          </aside>
        </div>
      )}
    </main>
  );
}
