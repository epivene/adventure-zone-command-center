type Message = {id:string; labelIds?:string[]; internalDateMs:number|null; from:string; to:string; subject:string; bodyText:string};
export type PilotState = "owner_decision"|"draft_to_review"|"draft_missing"|"reply_to_review"|"waiting_for_reply"|"contact_blocked"|"needs_review";
export function mailboxAddress(value:string):string|null {
  const candidate=value.match(/<([^<>]+)>\s*$/)?.[1]??value.trim();
  return /^[^\s<>@",]+@[^\s<>@",]+\.[^\s<>@",]+$/.test(candidate)?candidate.toLowerCase():null;
}
export function observePilotThread(messages: Message[], account:string, priorState:PilotState, reviewedMessageId:string, hadDraft=false,aliases:string[]=[]) {
  const ordered=[...messages].sort((a,b)=>(a.internalDateMs??0)-(b.internalDateMs??0)||a.id.localeCompare(b.id));
  if(ordered.some(m=>!Array.isArray(m.labelIds))) throw Error("PILOT_MESSAGE_LABELS_MISSING");
  const drafts=ordered.filter(m=>m.labelIds!.includes("DRAFT")&&!m.labelIds!.includes("TRASH"));
  const mail=ordered.filter(m=>!m.labelIds!.includes("DRAFT")&&!m.labelIds!.includes("TRASH"));
  const latest=mail.at(-1);
  const latestSentMessageId=mail.filter(m=>m.labelIds!.includes("SENT")).at(-1)?.id??null;
  const bounce=latest && /mailer-daemon@|postmaster@/i.test(latest.from) && /delivery|undeliver|address not found|5\.[0-9]\.[0-9]/i.test(latest.subject+" "+latest.bodyText);
  const outgoing=latest?.labelIds!.includes("SENT");
  const sender=latest?mailboxAddress(latest.from):null;
  const ownAddresses=new Set([account,...aliases].map(mailboxAddress).filter(Boolean));
  const external=latest && !outgoing && sender && !ownAddresses.has(sender);
  let state:PilotState=priorState;
  if(bounce) state="contact_blocked";
  else if(latest && (latest.id!==reviewedMessageId || priorState==="reply_to_review") && external && (!drafts.length || (latest.internalDateMs??0)>(drafts.at(-1)!.internalDateMs??0))) state="reply_to_review";
  else if(drafts.length) state="draft_to_review";
  else if(latest && latest.id!==reviewedMessageId && outgoing) state="waiting_for_reply";
  else if(hadDraft) state="draft_missing";
  return {state,drafts,latestMessageId:latest?.id??null,latestSentMessageId};
}
