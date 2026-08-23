import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ClipboardList, ContactRound, House, Mail, MessageCircle, Send } from "lucide-react";
import { officeGet, useOfficeAuth } from "@/lib/office-auth-context";

const items = [
  ["/office", "Today", House],
  ["/office/profiles", "Profiles", ContactRound],
  ["/office/mail", "Brochures", Mail],
  ["/office/emails", "Emails", Send],
  ["/office/tasks", "Tasks", ClipboardList],
  ["/office/messages", "Messages", MessageCircle],
] as const;

function Nav({ mobile=false, unread=0 }: { mobile?: boolean; unread?: number }) {
  const [location] = useLocation();
  return <nav aria-label="Office Coordinator navigation" className={mobile?"grid grid-cols-6 gap-1":"flex items-center gap-1"}>
    {items.map(([href,label,Icon])=>{const active=href==="/office"?location===href:location.startsWith(href);return <Link key={href} href={href} className={mobile?`relative flex min-h-14 flex-col items-center justify-center rounded-lg px-1 text-[10px] font-semibold ${active?"bg-orange-50 text-orange-700":"text-slate-600"}`:`relative inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold ${active?"bg-orange-50 text-orange-700":"text-slate-700 hover:bg-slate-100"}`}><Icon className="h-4 w-4"/><span>{label}</span>{label==="Messages"&&unread>0?<span className="absolute right-1 top-1 rounded-full bg-orange-600 px-1 text-[9px] font-bold text-white">{unread>9?"9+":unread}</span>:null}</Link>})}
  </nav>;
}

export function OfficeShell({ children }: { children: ReactNode }) {
  const { office, signOut } = useOfficeAuth();
  const [, setLocation] = useLocation();
  const [search,setSearch]=useState("");
  const [unread,setUnread]=useState(0);
  useEffect(()=>{let active=true;const load=()=>officeGet<{unreadMessages:number}>("/office/today").then((d)=>{if(active)setUnread(d.unreadMessages??0)}).catch(()=>{});void load();const id=window.setInterval(load,15000);return()=>{active=false;window.clearInterval(id)}},[]);
  function submit(event:FormEvent){event.preventDefault();const q=search.trim();setLocation(q?`/office/profiles?q=${encodeURIComponent(q)}`:"/office/profiles");}
  return <div className="min-h-screen bg-slate-50 text-slate-950">
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-6">
        <div className="flex items-center gap-3"><Link href="/office" className="min-w-0 flex-1 truncate font-bold">Adventure Zone <span className="ml-1 text-sm font-semibold text-orange-700">Office Coordinator</span></Link><div className="ml-auto hidden xl:block"><Nav unread={unread}/></div><button className="button-secondary hidden shrink-0 sm:inline-flex" type="button" onClick={signOut}>Sign out</button></div>
        <form className="mt-3 flex gap-2 md:mt-2" onSubmit={submit}><input aria-label="Search profiles" className="min-w-0 flex-1" placeholder="Search profiles, contacts, cities…" value={search} onChange={(e)=>setSearch(e.target.value)}/><button className="button-secondary shrink-0" type="submit">Search</button></form>
        {office?<p className="mt-1 truncate text-xs text-slate-500">Booking Workspace · {office.displayName}</p>:null}
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-5 pb-24 md:px-8 md:py-7 xl:pb-8">{children}</main>
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 xl:hidden"><Nav mobile unread={unread}/></div>
  </div>;
}
