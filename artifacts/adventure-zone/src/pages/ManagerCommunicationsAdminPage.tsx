import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/auth-token";
import { AttachmentFileMenu } from "@/components/manager-admin/attachment-file-menu";
import { MeetupRequestReview } from "@/components/manager-admin/meetup-request-review";
import { AcknowledgmentReview } from "@/components/manager-admin/acknowledgment-review";
import { AdminQuestionReview } from "@/components/manager-admin/admin-question-review";

type Tab="messages"|"requests"|"review"|"questions";
type Conversation={id:string;kind:string;title:string|null;unreadCount?:number};
type Attachment={id:string;fileName:string|null;downloadUrl?:string|null};
type Message={id:string;actorKind:string;actorName:string|null;body:string;attachments?:Attachment[]};
type MeetupRequest={id:string;requestingLegId:string;otherLegIds:string[];resourceId:string;meetupLabel:string;meetupLatitude:number|null;meetupLongitude:number|null;preferredStartsAt:string;preferredEndsAt:string;notes?:string|null;linkedConversationId?:string|null};
type Ack={id:string;title:string;managerComment:string|null;items:Array<{id:string;label:string;beforeValue:string|null;afterValue:string|null}>};
type AdminQuestion={id:string;travelLegId:string;bookingId:string|null;tripId:string|null;question:string;urgency:"normal"|"urgent";status:"needs_answer"|"answered"|"resolved";escalationReason:string;contextSnapshot?:any;createdAt?:string};
type Leg={id:string;name:string};
type Resource={id:string;name:string};

export default function ManagerCommunicationsAdminPage(){
  const [tab,setTab]=useState<Tab>("messages");
  const [conversations,setConversations]=useState<Conversation[]>([]);const [selectedId,setSelectedId]=useState<string|null>(null);const [messages,setMessages]=useState<Message[]>([]);
  const [requests,setRequests]=useState<MeetupRequest[]>([]);const [reviews,setReviews]=useState<Ack[]>([]);const [questions,setQuestions]=useState<AdminQuestion[]>([]);const [legs,setLegs]=useState<Leg[]>([]);const [resources,setResources]=useState<Resource[]>([]);const [error,setError]=useState("");
  const load=useCallback(async()=>{
    try{
      const [c,r,a,q,l,o]=await Promise.all([
        apiGet<{conversations:Conversation[]}>("/manager-admin/messages/conversations"),
        apiGet<{requests:MeetupRequest[]}>("/manager-admin/meetup-requests?status=pending_admin"),
        apiGet<{acknowledgments:Ack[]}>("/manager-admin/acknowledgments"),
        apiGet<{questions:AdminQuestion[]}>("/admin/manager-assistant/questions").catch(()=>({questions:[]})),
        apiGet<{legs:Array<{legId:string;legName:string;enabled?:boolean}>}>("/manager-admin/legs/access"),
        apiGet<{resources:Resource[]}>("/manager-admin/meetup-options").catch(()=>({resources:[]})),
      ]);
      setConversations(c.conversations??[]);setRequests(r.requests??[]);setReviews(a.acknowledgments??[]);setQuestions(q.questions??[]);setLegs((l.legs??[]).filter(x=>x.enabled!==false).map(x=>({id:x.legId,name:x.legName})));setResources(o.resources??[]);
    }catch(e){setError(e instanceof Error?e.message:"Could not load manager communications");}
  },[]);
  useEffect(()=>{void load();const timer=window.setInterval(()=>void load(),10000);return()=>window.clearInterval(timer);},[load]);
  async function openConversation(id:string){setTab("messages");setSelectedId(id);const data=await apiGet<{messages:Message[]}>(`/manager-admin/messages/conversations/${id}`);setMessages(data.messages??[]);}
  async function fileAttachment(input:{attachmentId:string;destination:any;destinationMetadata:Record<string,string>}){await apiPost(`/manager-admin/messages/attachments/${input.attachmentId}/file-to-leg`,{destination:input.destination,destinationMetadata:input.destinationMetadata,clientMutationId:crypto.randomUUID()});}
  async function approve(request:MeetupRequest,value:any){await apiPost(`/manager-admin/meetup-requests/${request.id}/approve`,value);await load();}
  async function dismiss(request:MeetupRequest,reason:string|null){await apiPost(`/manager-admin/meetup-requests/${request.id}/dismiss`,{reason});await load();}
  async function resolve(id:string,response:string){await apiPost(`/manager-admin/acknowledgments/${id}/resolve`,{response:response||null});await load();}
  const selected=useMemo(()=>conversations.find(c=>c.id===selectedId)??null,[conversations,selectedId]);
  const urgentQuestions=questions.filter(question=>question.urgency==="urgent"&&question.status==="needs_answer").length;
  return <div className="mx-auto grid max-w-6xl gap-4">
    <header><p className="text-sm font-bold uppercase tracking-wide text-orange-700">Leg managers</p><h1 className="text-3xl font-bold">Manager communications</h1><p className="mt-1 text-sm text-slate-600">Chats, Admin Questions, meetup requests, and manager follow-up in one place.</p></header>
    <div className="flex flex-wrap gap-2" role="tablist">
      <button className={tab==="messages"?"button-primary":"button-secondary"} onClick={()=>setTab("messages")} type="button">Messages</button>
      <button className={tab==="questions"?"button-primary":"button-secondary"} onClick={()=>setTab("questions")} type="button">Admin Questions{questions.length?` (${questions.length})`:""}{urgentQuestions?` · ${urgentQuestions} urgent`:""}</button>
      <button className={tab==="requests"?"button-primary":"button-secondary"} onClick={()=>setTab("requests")} type="button">Requests{requests.length?` (${requests.length})`:""}</button>
      <button className={tab==="review"?"button-primary":"button-secondary"} onClick={()=>setTab("review")} type="button">Needs review{reviews.length?` (${reviews.length})`:""}</button>
    </div>
    {tab==="messages"?<section className="grid gap-3 md:grid-cols-[18rem_1fr]">
      <div className="overflow-hidden rounded-xl border bg-white">{conversations.length?conversations.map(c=><button aria-label={c.title||"Conversation"} className={`block w-full border-b px-4 py-3 text-left last:border-b-0 ${selectedId===c.id?"bg-orange-50":"hover:bg-slate-50"}`} key={c.id} onClick={()=>void openConversation(c.id)} type="button"><span className="font-semibold">{c.title||"Conversation"}</span>{c.unreadCount?<span className="ml-2 text-xs font-bold text-orange-700">{c.unreadCount} unread</span>:null}</button>):<p className="p-4 text-sm text-slate-500">No manager conversations yet.</p>}</div>
      <div className="min-h-72 rounded-xl border bg-white p-4">{selected?<><h2 className="font-bold">{selected.title||"Conversation"}</h2><div className="mt-3 grid gap-3">{messages.length?messages.map(m=><div className="rounded-xl bg-slate-50 p-3" key={m.id}><p className="text-xs font-bold text-slate-500">{m.actorName||(m.actorKind==="admin"?"Admin":"Manager")}</p><p className="whitespace-pre-wrap text-sm">{m.body}</p>{(m.attachments??[]).map(a=><div className="mt-2 flex flex-wrap items-center gap-2" key={a.id}>{a.downloadUrl?<a className="text-sm font-semibold text-orange-700 underline" href={a.downloadUrl} rel="noreferrer" target="_blank">{a.fileName||"Open attachment"}</a>:<span className="text-sm">{a.fileName||"Attachment"}</span>}<AttachmentFileMenu attachment={a} legs={legs} onFile={fileAttachment}/></div>)}</div>):<p className="text-sm text-slate-500">No messages yet.</p>}</div></>:<p className="text-sm text-slate-500">Choose a conversation.</p>}</div>
    </section>:null}
    {tab==="questions"?<section className="grid gap-3">{questions.length?questions.map(question=><AdminQuestionReview key={question.id} question={question} onChanged={load}/>):<div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No Admin Questions need attention.</div>}</section>:null}
    {tab==="requests"?<section className="grid gap-3">{requests.length?requests.map(request=><MeetupRequestReview key={request.id} request={request} legs={legs} resources={resources} onApprove={value=>void approve(request,value)} onDismiss={reason=>void dismiss(request,reason)} onOpenConversation={id=>void openConversation(id)}/>):<div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No meetup requests need review.</div>}</section>:null}
    {tab==="review"?<section className="grid gap-3">{reviews.length?reviews.map(review=><AcknowledgmentReview acknowledgment={review} key={review.id} onResolve={resolve}/>):<div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No manager comments need review.</div>}</section>:null}
    {error?<p className="text-sm font-semibold text-red-600" role="alert">{error}</p>:null}
  </div>;
}