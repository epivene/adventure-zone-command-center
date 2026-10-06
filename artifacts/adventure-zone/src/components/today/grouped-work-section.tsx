import { useState } from "react";
import { Link } from "wouter";
import type { MasterWorkItem } from "@/features/today/master-work-types";
import { masterWorkHref } from "@/features/today/group-master-work";
export function GroupedWorkSection({title,items,onOpen}: {title:string;items:MasterWorkItem[];onOpen:(item:MasterWorkItem,filter:string)=>void}) {
 const [expanded,setExpanded]=useState(false);
 return <section className="min-w-0 rounded-xl border bg-card" aria-label={title}>
   <div className="flex items-center justify-between gap-3 border-b px-4 py-3"><h2 className="text-lg font-bold">{title}</h2><span className="text-sm text-muted-foreground">{items.length}</span></div>
   {items.length ? <ul className="divide-y">{(expanded?items:items.slice(0,5)).map(item=><li key={item.id}><Link href={masterWorkHref(item)} onClick={()=>onOpen(item,title)} data-work-item-id={item.id} className="block min-h-11 px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"><div className="flex items-start justify-between gap-3"><p className="min-w-0 break-words text-sm font-semibold">{item.eventName}</p><span className="shrink-0 text-xs text-muted-foreground">{item.kind.replaceAll("_"," ")}</span></div><p className="mt-1 text-sm text-muted-foreground">{item.reason}</p>{item.dueAt ? <p className="mt-1 text-xs text-muted-foreground">Due {new Date(item.dueAt).toLocaleDateString()}</p> : null}</Link></li>)}</ul> : <p className="px-4 py-3 text-sm text-muted-foreground">Nothing needs attention here.</p>}
   {items.length>5 ? <button className="min-h-11 w-full border-t px-4 py-2 text-left text-sm font-semibold text-primary" type="button" onClick={()=>setExpanded(value=>!value)}>{expanded?"Show less":"Show all "+items.length}</button> : null}
 </section>;
}
