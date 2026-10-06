import type { MasterTodayQueue, MasterWorkItem } from "./master-work-types";
export function groupMasterWork(queue: MasterTodayQueue, now = new Date()) {
  const groups: Record<"replies" | "calls" | "booking" | "waiting" | "later" | "completed", MasterWorkItem[]> = { replies:[],calls:[],booking:[],waiting:[],later:[],completed:[] };
  const unique = new Map<string,MasterWorkItem>();
  const rank: Record<string,number> = {review:3,draft:2,reply:1};
  for(const item of [...queue.needsAttention,...queue.active,...queue.completedToday]) {
    const family = ["reply","draft","review"].includes(item.kind) ? "mail-action" : item.kind;
    const source = family === "mail-action" && item.threadId ? [item.gmailConnectionId || "",item.organizationId || "",item.threadId].join(":") : item.sourceType+":"+item.sourceId;
    const key = source+":"+item.sourceType+":"+item.sourceId+":"+family;
    const old=unique.get(key);
    if(!old || (rank[item.kind] || 0) > (rank[old.kind] || 0)) unique.set(key,item);
  }
  for(const item of unique.values()) {
    if(item.completedAt || queue.completedToday.some(done=>done.id===item.id)) groups.completed.push(item);
    else if(item.attentionState==="waiting_for_their_reply" && (!item.dueAt || Date.parse(item.dueAt)>now.getTime())) groups.waiting.push(item);
    else if(item.kind==="follow_up" && item.dueAt && Date.parse(item.dueAt)>now.getTime()) groups.later.push(item);
    else if(["reply","draft","review"].includes(item.kind)) groups.replies.push(item);
    else if(["callback","follow_up"].includes(item.kind)) groups.calls.push(item);
    else groups.booking.push(item);
  }
  const urgency={urgent:0,high:1,normal:2};
  const due=(v:string|null)=> v && Number.isFinite(Date.parse(v)) ? Date.parse(v) : Infinity;
  for(const items of Object.values(groups)) items.sort((a,b)=>
    Number(b.pinned)-Number(a.pinned) ||
    (a.manualOrder??Infinity)-(b.manualOrder??Infinity) ||
    urgency[a.priority]-urgency[b.priority] ||
    due(a.dueAt)-due(b.dueAt) || a.id.localeCompare(b.id));
  return groups;
}
export function masterWorkHref(item: MasterWorkItem): string {
  if(item.threadId && ["reply","draft","review"].includes(item.kind)) {
    const params=new URLSearchParams({view:item.kind==="review"?"review":item.kind==="draft"?"drafts":"needs_reply",threadId:item.threadId,from:"today",workItemId:item.id});
    if(item.organizationId) params.set("profileId",item.organizationId);
    if(item.gmailConnectionId) params.set("accountId",item.gmailConnectionId);
    if(item.kind==="review" && item.messageId) params.set("reviewMessageId",item.messageId);
    return "/emails?"+params;
  }
  if(!item.organizationId) return item.bookingId ? "/bookings/"+item.bookingId : "/profiles";
  const params=new URLSearchParams({from:"today",workItemId:item.id});
  if(item.bookingId) params.set("bookingId",item.bookingId);
  if(item.contactId) params.set("contactId",item.contactId);
  return "/profiles/"+item.organizationId+"?"+params;
}
