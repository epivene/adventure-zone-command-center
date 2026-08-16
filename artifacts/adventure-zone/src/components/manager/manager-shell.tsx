import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft, Home, MapPinned, LogOut, MessageCircle, WalletCards, UsersRound } from "lucide-react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue } from "@/lib/manager-sync-queue";
import { managerBackTarget } from "@/lib/manager-back-target";
import { ManagerActionCenter } from "./manager-action-center";

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const { manager, signOut, managerApi } = useManagerAuth();
  const [location] = useLocation();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const backTarget = managerBackTarget(location);

  useEffect(() => {
    const flush = () => void flushManagerMutationQueue(managerApi).catch(() => undefined);
    flush();
    window.addEventListener("online", flush);
    return () => window.removeEventListener("online", flush);
  }, [managerApi]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await managerApi<{ conversations: Array<{ unreadCount?: number }> }>("/manager/messages/conversations");
        if (active) setUnreadMessages((data.conversations ?? []).reduce((sum, row) => sum + (row.unreadCount ?? 0), 0));
      } catch {
        if (active) setUnreadMessages(0);
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(id); };
  }, [managerApi, location]);

  return <div className="min-h-dvh bg-slate-50 pb-20">
    <header className="sticky top-0 z-10 border-b bg-white px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          {backTarget ? <Link href={backTarget} className="flex shrink-0 items-center gap-1 rounded-lg border px-2 py-2 text-sm font-semibold" aria-label="Back"><ArrowLeft className="h-4 w-4"/><span className="hidden sm:inline">Back</span></Link> : null}
          <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Leg Manager Portal</p><p className="truncate font-semibold">{manager?.legName}</p></div>
        </div>
        <button className="rounded-lg p-2" aria-label="Sign out" onClick={signOut}><LogOut className="h-5 w-5" /></button>
      </div>
    </header>
    <ManagerActionCenter />
    <main className="mx-auto max-w-3xl p-4">{children}</main>
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t bg-white"><div className="mx-auto grid max-w-3xl grid-cols-5">
      <Link href="/manager" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><Home className="h-5 w-5" />Home</Link>
      <Link href="/manager/route" className="flex min-h-16 flex-col items-center justify-center text-center text-xs font-semibold"><MapPinned className="h-5 w-5" />Events / Route</Link>
      <Link href="/manager/money" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><WalletCards className="h-5 w-5" />Money</Link>
      <Link href="/manager/crew" className="flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><UsersRound className="h-5 w-5" />Crew</Link>
      <Link href="/manager/messages" className="relative flex min-h-16 flex-col items-center justify-center text-xs font-semibold"><span className="relative"><MessageCircle className="h-5 w-5" />{unreadMessages ? <span aria-label={`${unreadMessages} unread messages`} className="absolute -right-3 -top-2 min-w-5 rounded-full bg-orange-600 px-1 text-center text-[10px] font-bold leading-5 text-white">{unreadMessages > 99 ? "99+" : unreadMessages}</span> : null}</span>Messages</Link>
    </div></nav>
  </div>;
}
