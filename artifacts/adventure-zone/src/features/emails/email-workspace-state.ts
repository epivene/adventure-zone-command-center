export type EmailWorkspaceView = "inbox" | "sent" | "drafts" | "review" | "needs_reply" | "waiting";
export type EmailWorkspaceState = { view: EmailWorkspaceView; query: string; folder: "inbox" | "sent" | "drafts" | "search"; threadId?: string; draftId?: string; profileId?: string; attentionMessage?: string; reviewMessageId?: string; accountId?: string };
export function readEmailWorkspaceState(search: string): EmailWorkspaceState {
  const params = new URLSearchParams(search);
  const candidate = params.get("view") || params.get("folder") || "inbox";
  const views = ["inbox","sent","drafts","review","needs_reply","waiting"];
  const view = (views.includes(candidate) ? candidate : "inbox") as EmailWorkspaceView;
  const query = params.get("q") || "";
  return { view, query, folder: params.get("folder") === "search" || candidate === "search" ? "search" : view === "sent" || view === "drafts" ? view : "inbox",
    threadId: params.get("threadId") || undefined, draftId: params.get("draftId") || undefined, profileId: params.get("profileId") || undefined,
    attentionMessage: params.get("attentionMessage") || undefined, reviewMessageId: params.get("reviewMessageId") || undefined, accountId: params.get("accountId") || undefined };
}
export function legacyReviewUrl(search: string): string {
  const params = new URLSearchParams(search); params.set("view", "review");
  return "/emails?" + params;
}

export type MailboxContext = {accountId:string;threadId?:string;draftId?:string;scrollY?:number;showProfile?:boolean;showList?:boolean;profileId?:string};
export function readMailboxContext(storage: Pick<Storage,"getItem">, accountId: string): MailboxContext | null {
  try { const saved = JSON.parse(storage.getItem("az-mailbox:"+accountId) || "null");
    return saved && saved.accountId === accountId ? saved : null;
  } catch { return null; }
}
export function isCurrentMailboxResponse(version: number, currentVersion: number, accountId: string, currentAccountId: string): boolean {
  return version === currentVersion && accountId === currentAccountId;
}

export function mailboxRestoreTarget(context: {accountId?:string;threadId?:string;draftId?:string;profileId?:string}, items: import("../google-workspace/mailbox-client").MailboxMessage[], accountId: string): import("../google-workspace/mailbox-client").MailboxMessage | null {
  if(context.accountId && context.accountId!==accountId) return null;
  if(!context.threadId && !context.draftId) return null;
  const found=items.find(item=>context.draftId?item.draftId===context.draftId:item.threadId===context.threadId);
  if(found) return found;
  return {id:context.draftId || context.threadId!,threadId:context.threadId || "",draftId:context.draftId || null,snippet:"",labelIds:[],internalDateMs:null,hasAttachments:false,headers:{from:"",to:"",subject:"",date:""},profiles:context.profileId?[{id:context.profileId,name:"Selected profile"}]:[]};
}
export function writeMailboxContext(storage: Pick<Storage,"setItem">, context: MailboxContext): void {
  storage.setItem("az-mailbox:"+context.accountId,JSON.stringify(context));
}
export type ReviewContext = {accountId:string;messageId?:string;scrollY:number;pane:"list"|"reader"};
export function readReviewContext(storage: Pick<Storage,"getItem">, accountId: string): ReviewContext | null {
  try { const context=JSON.parse(storage.getItem("az-email-review:"+accountId) || "null");return context?.accountId===accountId?context:null;} catch {return null;}
}
export function writeReviewContext(storage: Pick<Storage,"setItem">, context: ReviewContext): void {
  storage.setItem("az-email-review:"+context.accountId,JSON.stringify(context));
}
export function reviewSelectionUrl(search: string, messageId: string | null): string {
  const params=new URLSearchParams(search);params.set("view","review");params.delete("attentionMessage");
  if(messageId)params.set("reviewMessageId",messageId);else params.delete("reviewMessageId");
  return "/emails?"+params;
}
export function attentionContextKey(accountId: string, messageId: string, profileId: string): string {
  return [accountId,messageId,profileId].map(encodeURIComponent).join(":");
}
