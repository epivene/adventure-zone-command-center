import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Bot, Paperclip, Plus, Send, X } from "lucide-react";
import { useSearch } from "wouter";
import { listManagerLoginLegs, useManagerAuth } from "@/lib/manager-auth-context";
import { ManagerAssistantConversation } from "@/components/manager/manager-assistant-conversation";
import { MANAGER_ASSISTANT_PENDING_KEY, useManagerAssistant } from "@/features/manager-assistant/manager-assistant-context";
import type { ManagerAssistantContextRef } from "@/features/manager-assistant/manager-assistant-types";

type Conversation = { id: string; kind: string; title: string | null; unreadCount: number };
type Attachment = { id: string; fileName: string | null; mimeType: string | null; downloadUrl: string | null; uploadStatus: string };
type Message = { id: string; actorKind: string; actorLegId?: string | null; actorName: string | null; body: string; createdAt?: string; attachments?: Attachment[] };
type Leg = { id: string; name: string };
const ASSISTANT_ID = "__operations_assistant__";

type PendingAssistant = { context?: ManagerAssistantContextRef | null; prefill?: string };

export default function ManagerMessagesPage() {
  const { manager, managerApi } = useManagerAuth();
  const { setActiveContext } = useManagerAssistant();
  const search = useSearch();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [assistantPrefill, setAssistantPrefill] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [selectedLegs, setSelectedLegs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function loadConversations() {
    const data = await managerApi<{ conversations: Conversation[] }>("/manager/messages/conversations");
    setConversations(data.conversations ?? []);
  }
  async function loadMessages(id: string) {
    const data = await managerApi<{ messages: Message[] }>(`/manager/messages/conversations/${id}`);
    setMessages(data.messages ?? []);
  }

  useEffect(() => {
    if (!new URLSearchParams(search).has("assistant")) return;
    let pending: PendingAssistant | null = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(MANAGER_ASSISTANT_PENDING_KEY) ?? "null") as PendingAssistant | null;
      sessionStorage.removeItem(MANAGER_ASSISTANT_PENDING_KEY);
    } catch {}
    if (pending?.context) setActiveContext(pending.context);
    setAssistantPrefill(pending?.prefill ?? "");
    setSelectedId(ASSISTANT_ID);
  }, [search, setActiveContext]);

  useEffect(() => {
    void loadConversations().catch((e) => setError(e instanceof Error ? e.message : "Could not load messages"));
    const id = window.setInterval(() => void loadConversations().catch(() => {}), 5000);
    return () => window.clearInterval(id);
  }, [managerApi]);

  useEffect(() => {
    if (!selectedId || selectedId === ASSISTANT_ID) return;
    void loadMessages(selectedId).catch((e) => setError(e instanceof Error ? e.message : "Could not load conversation"));
    const id = window.setInterval(() => void loadMessages(selectedId).catch(() => {}), 5000);
    return () => window.clearInterval(id);
  }, [selectedId, managerApi]);

  const selected = useMemo(() => conversations.find((row) => row.id === selectedId) ?? null, [conversations, selectedId]);

  async function openNew() {
    setShowNew(true); setSelectedLegs([]);
    const rows = await listManagerLoginLegs();
    setLegs(rows.filter((leg) => leg.id !== manager?.legId));
  }

  async function startConversation() {
    if (!selectedLegs.length) return;
    const names = legs.filter((leg) => selectedLegs.includes(leg.id)).map((leg) => leg.name);
    const data = await managerApi<{ conversation: Conversation }>("/manager/messages/conversations", { method: "POST", body: JSON.stringify({ kind: selectedLegs.length === 1 ? "direct" : "group", title: names.join(" + "), memberLegIds: selectedLegs }) });
    setShowNew(false); await loadConversations(); setSelectedId(data.conversation.id);
  }

  async function sendMessage(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId || selectedId === ASSISTANT_ID || (!body.trim() && !file) || sending) return;
    setSending(true); setError(null);
    try {
      const attachmentIds: string[] = [];
      if (file) {
        const id = crypto.randomUUID();
        await managerApi(`/manager/messages/conversations/${selectedId}/attachments`, { method: "POST", body: JSON.stringify({ id, fileName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, clientMutationId: id }) });
        await managerApi(`/manager/messages/attachments/${id}/file`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        attachmentIds.push(id);
      }
      await managerApi(`/manager/messages/conversations/${selectedId}`, { method: "POST", body: JSON.stringify({ body: body.trim() || file?.name || "Attachment", clientMutationId: crypto.randomUUID(), attachmentIds }) });
      setBody(""); setFile(null); await Promise.all([loadMessages(selectedId), loadConversations()]);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not send message"); }
    finally { setSending(false); }
  }

  if (selectedId === ASSISTANT_ID) {
    return <div className="grid gap-3">
      <div className="flex items-center gap-2"><button aria-label="Back to conversations" className="button-secondary px-3" onClick={() => setSelectedId(null)} type="button"><ArrowLeft className="h-4 w-4" /></button><div><h1 className="text-xl font-bold">Operations Assistant</h1><p className="text-xs text-slate-500">Your private leg-scoped assistant. Admin questions stay attached here.</p></div></div>
      <ManagerAssistantConversation initialPrefill={assistantPrefill} />
    </div>;
  }

  if (selectedId && selected) {
    return <div className="grid gap-3">
      <div className="flex items-center gap-2"><button aria-label="Back to conversations" className="button-secondary px-3" onClick={() => setSelectedId(null)} type="button"><ArrowLeft className="h-4 w-4" /></button><div><h1 className="text-xl font-bold">{selected.title || "Conversation"}</h1><p className="text-xs text-slate-500">Messages are visible to admins.</p></div></div>
      <div className="min-h-72 rounded-xl border bg-white p-3">{messages.length ? <div className="grid gap-3">{messages.map((message) => { const mine = message.actorKind === "manager" && message.actorLegId === manager?.legId; return <div className={`max-w-[90%] rounded-xl px-3 py-2 ${mine ? "ml-auto bg-orange-50" : "bg-slate-100"}`} key={message.id}><p className="text-xs font-bold text-slate-500">{mine ? "You" : message.actorName || (message.actorKind === "admin" ? "Admin" : "Manager")}</p><p className="whitespace-pre-wrap text-sm">{message.body}</p>{(message.attachments ?? []).map((attachment) => attachment.downloadUrl ? <a className="mt-2 block text-sm font-semibold text-orange-700 underline" href={attachment.downloadUrl} key={attachment.id} rel="noreferrer" target="_blank">{attachment.fileName || "Open attachment"}</a> : <span className="mt-2 block text-xs text-slate-500" key={attachment.id}>{attachment.fileName || "Attachment"} is processing</span>)}</div>; })}</div> : <p className="text-sm text-slate-500">No messages yet.</p>}</div>
      <form className="rounded-xl border bg-white p-3" onSubmit={sendMessage}>{file ? <div className="mb-2 flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm"><Paperclip className="h-4 w-4"/><span className="min-w-0 flex-1 truncate">{file.name}</span><button aria-label="Remove attachment" onClick={() => setFile(null)} type="button"><X className="h-4 w-4"/></button></div> : null}<textarea aria-label="Message" className="min-h-20 w-full rounded-lg border p-2" onChange={(e) => setBody(e.target.value)} placeholder="Type a message…" value={body} /><div className="mt-2 flex items-center justify-between gap-2"><label className="button-secondary cursor-pointer"><Paperclip className="mr-1 inline h-4 w-4"/>Attach<input className="sr-only" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><button className="button-primary" disabled={sending || (!body.trim() && !file)} type="submit"><Send className="mr-1 inline h-4 w-4"/>{sending ? "Sending…" : "Send"}</button></div></form>
      {error ? <p className="text-sm font-semibold text-red-600" role="alert">{error}</p> : null}
    </div>;
  }

  return <div className="grid gap-4">
    <header className="flex items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">Messages</h1><p className="mt-1 text-sm text-slate-600">Assistant, admins, and other manager conversations in one place.</p></div><button className="button-primary whitespace-nowrap" onClick={openNew} type="button"><Plus className="mr-1 inline h-4 w-4"/>New message</button></header>
    {showNew ? <section className="rounded-xl border bg-white p-4"><div className="flex items-center justify-between"><h2 className="font-bold">New conversation</h2><button aria-label="Close new conversation" onClick={() => setShowNew(false)} type="button"><X className="h-4 w-4"/></button></div><p className="mt-1 text-sm text-slate-500">Choose one manager for a direct conversation or several for a group.</p><div className="mt-3 grid gap-2">{legs.map((leg) => <label className="flex items-center gap-2" key={leg.id}><input aria-label={leg.name} checked={selectedLegs.includes(leg.id)} onChange={(e) => setSelectedLegs((current) => e.target.checked ? [...current, leg.id] : current.filter((id) => id !== leg.id))} type="checkbox"/>{leg.name}</label>)}</div><button className="button-primary mt-3" disabled={!selectedLegs.length} onClick={startConversation} type="button">Start conversation</button></section> : null}
    <section className="overflow-hidden rounded-xl border bg-white">
      <button aria-label="Operations Assistant" className="flex w-full items-center gap-3 border-b bg-orange-50 px-4 py-4 text-left hover:bg-orange-100" onClick={() => { setAssistantPrefill(""); setSelectedId(ASSISTANT_ID); }} type="button"><span className="grid h-9 w-9 place-items-center rounded-full bg-orange-100 text-orange-700"><Bot className="h-5 w-5"/></span><span><span className="block font-bold">Operations Assistant</span><span className="block text-xs text-slate-600">Ask about this leg, events, setup, route, and check-ins</span></span><span className="ml-auto text-xs font-bold uppercase tracking-wide text-orange-700">Pinned</span></button>
      {conversations.length ? conversations.map((row) => <button aria-label={`${row.title || "Conversation"}${row.unreadCount ? `, ${row.unreadCount} unread` : ""}`} className="flex w-full items-center justify-between gap-3 border-b px-4 py-4 text-left last:border-b-0 hover:bg-slate-50" key={row.id} onClick={() => setSelectedId(row.id)} type="button"><span className="font-semibold">{row.title || "Conversation"}</span>{row.unreadCount ? <span className="rounded-full bg-orange-100 px-2 py-1 text-xs font-bold text-orange-800">{row.unreadCount} unread</span> : null}</button>) : <p className="p-4 text-sm text-slate-500">No other conversations yet.</p>}
    </section>
    {error ? <p className="text-sm font-semibold text-red-600" role="alert">{error}</p> : null}
  </div>;
}
