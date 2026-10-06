import { Link } from "wouter";
import type { ReactNode } from "react";
import type { ProfileHistoryItem } from "./profile-activity-history-model";
export function ProfileActivityHistory({items,children}: {items:ProfileHistoryItem[];children?:ReactNode}) {
 return <div className="grid gap-4">
 {items.length ? <ol className="divide-y rounded-xl border bg-card">{items.map(item=><li className="px-4 py-3" key={item.id}><div className="flex items-start justify-between gap-2"><span className="text-xs font-semibold capitalize text-muted-foreground">{item.kind}</span><time className="text-xs text-muted-foreground">{Number.isFinite(item.occurredAt.getTime())?item.occurredAt.toLocaleDateString():"Date unknown"}</time></div>{item.href?<Link className="mt-1 block text-sm font-semibold text-primary underline" href={item.href}>{item.body}</Link>:<p className="mt-1 whitespace-pre-wrap break-words text-sm">{item.body}</p>}</li>)}</ol>:<p className="text-sm text-muted-foreground">No activity recorded yet.</p>}
 {children?<details className="rounded-xl border bg-card p-3"><summary className="cursor-pointer text-sm font-semibold">Manage notes and older history</summary><div className="mt-3">{children}</div></details>:null}
 </div>;
}
