import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, apiGet, apiPost } from "@/lib/auth-token";
import { AttachmentFileMenu } from "@/components/manager-admin/attachment-file-menu";
import { MeetupRequestReview } from "@/components/manager-admin/meetup-request-review";
import { AcknowledgmentReview } from "@/components/manager-admin/acknowledgment-review";
import { AdminQuestionReview } from "@/components/manager-admin/admin-question-review";

type Tab = "messages" | "requests" | "review" | "questions";
type Conversation = { id: string; kind: string; title: string | null; unreadCount?: number };
type Attachment = { id: string; fileName: string | null; downloadUrl?: string | null };
type MessageAck = { id: string; legId: string; status: "waiting_acknowledgment" | "acknowledged" | "needs_admin_review" | "resolved"; managerComment: string | null; acknowledgedAt: string | null };
type Message = { id: string; actorKind: string; actorName: string | null; body: string; attachments?: Attachment[]; acknowledgments?: MessageAck[] };
type MeetupRequest = { id: string; requestingLegId: string; otherLegIds: string[]; resourceId: string; meetupLabel: string; meetupLatitude: number | null; meetupLongitude: number | null; preferredStartsAt: string; preferredEndsAt: string; notes?: string | null; linkedConversationId?: string | null };
type Ack = { id: string; title: string; managerComment: string | null; items: Array<{ id: string; label: string; beforeValue: string | null; afterValue: string | null }> };
type AdminQuestion = { id: string; travelLegId: string; bookingId: string | null; tripId: string | null; question: string; urgency: "normal" | "urgent"; status: "needs_answer" | "answered" | "resolved"; escalationReason: string; contextSnapshot?: any; createdAt?: string };
type Leg = { id: string; name: string };
type Resource = { id: string; name: string };

export default function ManagerCommunicationsAdminPage() {
  const [tab, setTab] = useState<Tab>("messages");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [requests, setRequests] = useState<MeetupRequest[]>([]);
  const [reviews, setReviews] = useState<Ack[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [legs, setLegs] = useState<Leg[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [selectedLegs, setSelectedLegs] = useState<string[]>([]);
  const [subject, setSubject] = useState("");
  const [newBody, setNewBody] = useState("");
  const [requireAck, setRequireAck] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [replyRequireAck, setReplyRequireAck] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, r, a, q, l, o] = await Promise.all([
        apiGet<{ conversations: Conversation[] }>("/manager-admin/messages/conversations"),
        apiGet<{ requests: MeetupRequest[] }>("/manager-admin/meetup-requests?status=pending_admin"),
        apiGet<{ acknowledgments: Ack[] }>("/manager-admin/acknowledgments"),
        apiGet<{ questions: AdminQuestion[] }>("/admin/manager-assistant/questions").catch(() => ({ questions: [] })),
        apiGet<{ legs: Array<{ legId: string; legName: string; enabled?: boolean }> }>("/manager-admin/legs/access"),
        apiGet<{ resources: Resource[] }>("/manager-admin/meetup-options").catch(() => ({ resources: [] })),
      ]);
      setConversations(c.conversations ?? []);
      setRequests(r.requests ?? []);
      setReviews(a.acknowledgments ?? []);
      setQuestions(q.questions ?? []);
      setLegs((l.legs ?? []).filter((x) => x.enabled !== false).map((x) => ({ id: x.legId, name: x.legName })));
      setResources(o.resources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load manager communications");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function openConversation(id: string) {
    setTab("messages");
    setSelectedId(id);
    const data = await apiGet<{ messages: Message[] }>(`/manager-admin/messages/conversations/${id}`);
    setMessages(data.messages ?? []);
    await load();
  }

  async function uploadAttachment(conversationId: string, file: File) {
    const id = crypto.randomUUID();
    await apiPost(`/manager-admin/messages/conversations/${conversationId}/attachments`, {
      id,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      clientMutationId: id,
    });
    const response = await apiFetch(`/manager-admin/messages/attachments/${id}/file`, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!response.ok) throw new Error("Could not upload attachment");
    return id;
  }

  async function sendNewMessage() {
    if (!selectedLegs.length || !subject.trim() || !newBody.trim() || sending) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const allSelected = legs.length > 0 && selectedLegs.length === legs.length;
      const kind = allSelected ? "all_managers" : selectedLegs.length === 1 ? "leg_admin" : "group";
      const created = await apiPost<{ conversation: Conversation }>("/manager-admin/messages/conversations", {
        kind,
        title: subject.trim(),
        memberLegIds: selectedLegs,
      });
      const attachmentIds: string[] = [];
      if (newFile) attachmentIds.push(await uploadAttachment(created.conversation.id, newFile));
      const sent = await apiPost<{ message: Message; acknowledgments?: Array<{ id: string }> }>(
        `/manager-admin/messages/conversations/${created.conversation.id}`,
        {
          body: newBody.trim(),
          clientMutationId: crypto.randomUUID(),
          attachmentIds,
          requireAcknowledgment: requireAck,
          acknowledgmentTitle: requireAck ? subject.trim() : null,
        },
      );
      const count = sent.acknowledgments?.length ?? 0;
      setNotice(requireAck ? `${count} ${count === 1 ? "manager needs" : "managers need"} to acknowledge this message.` : "Message sent.");
      setShowNew(false);
      setSelectedLegs([]);
      setSubject("");
      setNewBody("");
      setRequireAck(false);
      setNewFile(null);
      await load();
      await openConversation(created.conversation.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  async function sendReply() {
    if (!selectedId || !replyBody.trim() || sending) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const sent = await apiPost<{ message: Message; acknowledgments?: Array<{ id: string }> }>(
        `/manager-admin/messages/conversations/${selectedId}`,
        {
          body: replyBody.trim(),
          clientMutationId: crypto.randomUUID(),
          attachmentIds: [],
          requireAcknowledgment: replyRequireAck,
          acknowledgmentTitle: replyRequireAck ? (selected?.title || "Message from Admin") : null,
        },
      );
      const count = sent.acknowledgments?.length ?? 0;
      setNotice(replyRequireAck ? `${count} ${count === 1 ? "manager needs" : "managers need"} to acknowledge this message.` : "Message sent.");
      setReplyBody("");
      setReplyRequireAck(false);
      await openConversation(selectedId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  async function fileAttachment(input: { attachmentId: string; destination: any; destinationMetadata: Record<string, string> }) {
    await apiPost(`/manager-admin/messages/attachments/${input.attachmentId}/file-to-leg`, {
      destination: input.destination,
      destinationMetadata: input.destinationMetadata,
      clientMutationId: crypto.randomUUID(),
    });
  }

  async function approve(request: MeetupRequest, value: any) {
    await apiPost(`/manager-admin/meetup-requests/${request.id}/approve`, value);
    await load();
  }
  async function dismiss(request: MeetupRequest, reason: string | null) {
    await apiPost(`/manager-admin/meetup-requests/${request.id}/dismiss`, { reason });
    await load();
  }
  async function resolve(id: string, response: string) {
    await apiPost(`/manager-admin/acknowledgments/${id}/resolve`, { response: response || null });
    await load();
  }

  const selected = useMemo(() => conversations.find((c) => c.id === selectedId) ?? null, [conversations, selectedId]);
  const urgentQuestions = questions.filter((question) => question.urgency === "urgent" && question.status === "needs_answer").length;
  const legName = (id: string) => legs.find((leg) => leg.id === id)?.name ?? "Manager";

  return <div className="mx-auto grid max-w-6xl gap-4">
    <header>
      <p className="text-sm font-bold uppercase tracking-wide text-orange-700">Leg managers</p>
      <h1 className="text-3xl font-bold">Manager communications</h1>
      <p className="mt-1 text-sm text-slate-600">Chats, Admin Questions, meetup requests, and manager follow-up in one place.</p>
    </header>

    <div className="flex flex-wrap gap-2" role="tablist">
      <button className={tab === "messages" ? "button-primary" : "button-secondary"} onClick={() => setTab("messages")} type="button">Messages</button>
      <button className={tab === "questions" ? "button-primary" : "button-secondary"} onClick={() => setTab("questions")} type="button">Admin Questions{questions.length ? ` (${questions.length})` : ""}{urgentQuestions ? ` · ${urgentQuestions} urgent` : ""}</button>
      <button className={tab === "requests" ? "button-primary" : "button-secondary"} onClick={() => setTab("requests")} type="button">Requests{requests.length ? ` (${requests.length})` : ""}</button>
      <button className={tab === "review" ? "button-primary" : "button-secondary"} onClick={() => setTab("review")} type="button">Needs review{reviews.length ? ` (${reviews.length})` : ""}</button>
    </div>

    {notice ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-800" role="status">{notice}</p> : null}

    {tab === "messages" ? <>
      <div className="flex justify-end"><button className="button-primary" onClick={() => setShowNew((value) => !value)} type="button">+ New message</button></div>
      {showNew ? <section className="grid gap-3 rounded-xl border bg-white p-4">
        <div><h2 className="text-lg font-bold">New message</h2><p className="text-sm text-slate-500">Send to one manager, several managers, or everyone.</p></div>
        <div className="grid gap-2 sm:grid-cols-2">{legs.map((leg) => <label className="flex items-center gap-2 rounded-lg border px-3 py-2" key={leg.id}><input aria-label={leg.name} checked={selectedLegs.includes(leg.id)} onChange={(event) => setSelectedLegs((current) => event.target.checked ? [...current, leg.id] : current.filter((id) => id !== leg.id))} type="checkbox"/>{leg.name}</label>)}</div>
        <button className="button-secondary w-fit" onClick={() => setSelectedLegs(selectedLegs.length === legs.length ? [] : legs.map((leg) => leg.id))} type="button">{selectedLegs.length === legs.length && legs.length ? "Clear all" : "Select all managers"}</button>
        <label className="grid gap-1 text-sm font-semibold">Subject<input aria-label="Subject" value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
        <label className="grid gap-1 text-sm font-semibold">Message<textarea aria-label="Message" className="min-h-28" value={newBody} onChange={(event) => setNewBody(event.target.value)} /></label>
        <label className="flex items-start gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm"><input aria-label="Require acknowledgment" checked={requireAck} onChange={(event) => setRequireAck(event.target.checked)} type="checkbox"/><span><strong>Require acknowledgment</strong><br/><span className="text-slate-600">Managers must confirm they saw this message. They can add a comment if needed.</span></span></label>
        <label className="grid gap-1 text-sm font-semibold">Attachment (optional)<input type="file" onChange={(event) => setNewFile(event.target.files?.[0] ?? null)} /></label>
        <div className="flex gap-2"><button className="button-primary" disabled={sending || !selectedLegs.length || !subject.trim() || !newBody.trim()} onClick={() => void sendNewMessage()} type="button">{sending ? "Sending…" : "Send message"}</button><button className="button-secondary" onClick={() => setShowNew(false)} type="button">Cancel</button></div>
      </section> : null}

      <section className="grid gap-3 md:grid-cols-[18rem_1fr]">
        <div className="overflow-hidden rounded-xl border bg-white">
          {conversations.length ? conversations.map((conversation) => {
            const unread = conversation.unreadCount ?? 0;
            return <button
              aria-label={`${conversation.title || "Conversation"}${unread ? `, ${unread} unread` : ""}`}
              className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 ${selectedId === conversation.id ? "bg-orange-50" : "hover:bg-slate-50"}`}
              key={conversation.id}
              onClick={() => void openConversation(conversation.id)}
              type="button"
            >
              <span className={`min-w-0 flex-1 truncate ${unread ? "font-bold text-slate-950" : "font-semibold text-slate-700"}`}>{conversation.title || "Conversation"}</span>
              {unread ? <span className="flex min-h-6 min-w-6 items-center justify-center rounded-full bg-orange-600 px-1.5 text-xs font-bold text-white">{unread > 9 ? "9+" : unread}</span> : null}
            </button>;
          }) : <p className="p-4 text-sm text-slate-500">No manager conversations yet.</p>}
        </div>

        <div className="min-h-72 rounded-xl border bg-white p-4">
          {selected ? <>
            <h2 className="font-bold">{selected.title || "Conversation"}</h2>
            <div className="mt-3 grid gap-3">
              {messages.length ? messages.map((message) => {
                const mine = message.actorKind === "admin";
                const acks = message.acknowledgments ?? [];
                const acknowledged = acks.filter((ack) => ack.status !== "waiting_acknowledgment").length;
                const waiting = acks.filter((ack) => ack.status === "waiting_acknowledgment");
                return <div className={`max-w-[90%] rounded-2xl px-3 py-2 ${mine ? "ml-auto bg-orange-50" : "mr-auto bg-slate-100"}`} key={message.id}>
                  <p className="text-xs font-bold text-slate-500">{mine ? "You" : message.actorName || "Manager"}</p>
                  <p className="whitespace-pre-wrap text-sm">{message.body}</p>
                  {acks.length ? <div className="mt-2 rounded-lg border border-orange-200 bg-white p-2 text-xs">
                    <p className="font-bold text-orange-800">{acknowledged}/{acks.length} acknowledged</p>
                    {waiting.length ? <p className="mt-1 text-slate-600">Waiting on: {waiting.map((ack) => legName(ack.legId)).join(", ")}</p> : <p className="mt-1 text-emerald-700">Everyone acknowledged.</p>}
                    {acks.filter((ack) => ack.managerComment).map((ack) => <p className="mt-1 text-slate-700" key={ack.id}><strong>{legName(ack.legId)}:</strong> {ack.managerComment}</p>)}
                  </div> : null}
                  {(message.attachments ?? []).map((attachment) => <div className="mt-2 flex flex-wrap items-center gap-2" key={attachment.id}>
                    {attachment.downloadUrl ? <a className="text-sm font-semibold text-orange-700 underline" href={attachment.downloadUrl} rel="noreferrer" target="_blank">{attachment.fileName || "Open attachment"}</a> : <span className="text-sm">{attachment.fileName || "Attachment"}</span>}
                    <AttachmentFileMenu attachment={attachment} legs={legs} onFile={fileAttachment}/>
                  </div>)}
                </div>;
              }) : <p className="text-sm text-slate-500">No messages yet.</p>}
            </div>
            <div className="mt-4 grid gap-2 border-t pt-4">
              <label className="grid gap-1 text-sm font-semibold">Reply<textarea aria-label="Reply message" className="min-h-20" value={replyBody} onChange={(event) => setReplyBody(event.target.value)} /></label>
              <label className="flex items-center gap-2 text-sm"><input checked={replyRequireAck} onChange={(event) => setReplyRequireAck(event.target.checked)} type="checkbox"/>Require acknowledgment</label>
              <button className="button-primary w-fit" disabled={sending || !replyBody.trim()} onClick={() => void sendReply()} type="button">Send reply</button>
            </div>
          </> : <p className="text-sm text-slate-500">Choose a conversation.</p>}
        </div>
      </section>
    </> : null}

    {tab === "questions" ? <section className="grid gap-3">{questions.length ? questions.map((question) => <AdminQuestionReview key={question.id} question={question} onChanged={load}/>) : <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No Admin Questions need attention.</div>}</section> : null}
    {tab === "requests" ? <section className="grid gap-3">{requests.length ? requests.map((request) => <MeetupRequestReview key={request.id} request={request} legs={legs} resources={resources} onApprove={(value) => void approve(request, value)} onDismiss={(reason) => void dismiss(request, reason)} onOpenConversation={(id) => void openConversation(id)}/>) : <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No meetup requests need review.</div>}</section> : null}
    {tab === "review" ? <section className="grid gap-3">{reviews.length ? reviews.map((review) => <AcknowledgmentReview acknowledgment={review} key={review.id} onResolve={resolve}/>) : <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No manager comments need review.</div>}</section> : null}
    {error ? <p className="text-sm font-semibold text-red-600" role="alert">{error}</p> : null}
  </div>;
}
