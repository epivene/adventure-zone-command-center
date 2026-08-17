import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { ArrowLeft } from "lucide-react";
import { useManagerAuth } from "@/lib/manager-auth-context";
import { flushManagerMutationQueue } from "@/lib/manager-sync-queue";
import { managerBackTarget } from "@/lib/manager-back-target";
import { ManagerAssistantProvider } from "@/features/manager-assistant/manager-assistant-context";
import { ManagerAssistantDrawer } from "./manager-assistant-drawer";
import { ManagerAssistantLauncher } from "./manager-assistant-launcher";
import { ManagerActionCenter } from "./manager-action-center";
import { ManagerMobileNav } from "./manager-mobile-nav";

function ManagerShellInner({ children }: { children: React.ReactNode }) {
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

  return <div className="min-h-dvh bg-slate-50 pb-24">
    <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        {backTarget ? <Link href={backTarget} className="flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-2 text-sm font-semibold" aria-label="Back"><ArrowLeft className="h-4 w-4"/><span className="hidden sm:inline">Back</span></Link> : null}
        <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-orange-700">Leg Manager</p><p className="truncate font-semibold">{manager?.legName}</p></div>
      </div>
    </header>
    <ManagerActionCenter />
    <main className="mx-auto max-w-3xl p-4">{children}</main>
    <ManagerAssistantLauncher />
    <ManagerAssistantDrawer />
    <ManagerMobileNav unreadMessages={unreadMessages} onSignOut={signOut} />
  </div>;
}

export function ManagerShell({ children }: { children: React.ReactNode }) {
  const { manager } = useManagerAuth();
  const defaultContext = manager
    ? { kind: "leg" as const, recordId: manager.legId, label: manager.legName }
    : null;
  return (
    <ManagerAssistantProvider defaultContext={defaultContext}>
      <ManagerShellInner>{children}</ManagerShellInner>
    </ManagerAssistantProvider>
  );
}