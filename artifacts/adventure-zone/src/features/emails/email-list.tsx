import type { MailboxMessage } from "@/features/google-workspace/mailbox-client";
export function EmailList({items,selectedId,busy=false,onSelect}: {items:MailboxMessage[];selectedId?:string;busy?:boolean;onSelect:(item:MailboxMessage)=>void}) {
  return <div className="divide-y divide-border">{items.map(row => <button key={row.id} type="button" disabled={busy} aria-pressed={selectedId===row.id} onClick={()=>onSelect(row)} className={"block min-h-11 w-full min-w-0 p-3 text-left transition focus-visible:outline-2 focus-visible:outline-ring "+(selectedId===row.id?"bg-secondary":"hover:bg-muted")}>
    <div className="flex items-start justify-between gap-2"><span className={"min-w-0 truncate text-sm "+(row.labelIds.includes("UNREAD")?"font-bold":"font-medium")}>{row.profiles[0]?.name || row.headers.from || row.headers.to || "Unknown sender"}</span><time className="shrink-0 text-[11px] text-muted-foreground">{row.internalDateMs ? new Date(row.internalDateMs).toLocaleDateString(undefined,{month:"short",day:"numeric"}) : ""}</time></div>
    <p className="mt-1 truncate text-sm">{row.headers.subject || "(No subject)"}</p>
    <p className="mt-1 truncate text-xs text-muted-foreground">{row.snippet}</p>
    {row.labelIds.includes("UNREAD") || row.draftId || row.hasAttachments ? <p className="mt-1 text-[11px] text-muted-foreground">{[row.labelIds.includes("UNREAD")?"Unread":"",row.draftId?"Draft":"",row.hasAttachments?"Attachment":""].filter(Boolean).join(" · ")}</p> : null}
  </button>)}</div>;
}
