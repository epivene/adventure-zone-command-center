import { Link, useLocation } from "wouter";
import { useEffect, useState, type ReactNode } from "react";
import { CalendarDays, ContactRound, House } from "lucide-react";
import { AddMenu, AppMenu } from "./app-menu";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MessageBubbleLink } from "./message-bubble-link";
import { AssistantDrawer } from "@/components/assistant/assistant-drawer";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantNavigationContextSync } from "@/components/assistant/assistant-navigation-context-sync";
import { OfficeCoordinatorAttention, type OfficeCoordinatorAttentionData } from "@/components/today/office-coordinator-attention";
import { apiGet } from "@/lib/auth-token";

const primaryNavigation = [
  { href: "/today", label: "Today", icon: House },
  { href: "/profiles", label: "Profiles", icon: ContactRound },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [officeAttention, setOfficeAttention] = useState<OfficeCoordinatorAttentionData | null>(null);
  const hideAssistantLauncher = location.startsWith("/profiles/") || location.startsWith("/event-profiles/");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await apiGet<{ conversations: Array<{ unreadCount?: number }> }>("/manager-admin/messages/conversations");
        if (active) setUnreadMessages((data.conversations ?? []).reduce((sum, row) => sum + (row.unreadCount ?? 0), 0));
      } catch {
        if (active) setUnreadMessages(0);
      }
    };
    void refresh();
    const id = window.setInterval(refresh, 15000);
    return () => { active = false; window.clearInterval(id); };
  }, [location]);

  useEffect(() => {
    let active = true;
    if (location !== "/today") { setOfficeAttention(null); return; }
    apiGet<{ officeCoordinatorAttention?: OfficeCoordinatorAttentionData }>("/today")
      .then((data) => { if (active) setOfficeAttention(data.officeCoordinatorAttention ?? null); })
      .catch(() => { if (active) setOfficeAttention(null); });
    return () => { active = false; };
  }, [location]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-950">
      <AssistantNavigationContextSync />
      <header className="sticky top-0 z-20 hidden border-b border-slate-200 bg-white/95 backdrop-blur md:block">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-6 py-3">
          <Link className="mr-3 min-w-max font-bold tracking-tight" href="/today">
            Adventure Zone
            <span className="ml-2 text-sm font-medium text-slate-500">Command Center</span>
          </Link>
          <nav aria-label="Main navigation" className="flex items-center gap-1">
            {primaryNavigation.map((item) => {
              const active = location === item.href || location.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link aria-current={active ? "page" : undefined} className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${active ? "bg-orange-50 text-orange-700" : "text-slate-700 hover:bg-slate-100"}`} href={item.href} key={item.href}>
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <MessageBubbleLink href="/manager-communications" label="Messages" unreadCount={unreadMessages} />
            <AddMenu />
            <AppMenu />
          </div>
        </div>
      </header>

      <div className="fixed right-4 top-4 z-30 md:hidden">
        <MessageBubbleLink href="/manager-communications" label="Messages" unreadCount={unreadMessages} />
      </div>

      <main className="min-h-screen px-4 py-5 pb-28 md:px-8 md:py-7 md:pb-8">
        {location === "/today" ? <div className="mx-auto mb-6 max-w-5xl"><OfficeCoordinatorAttention attention={officeAttention} /></div> : null}
        {children}
      </main>

      {!hideAssistantLauncher ? <AssistantLauncher /> : null}
      <AssistantDrawer />
      <MobileBottomNav />
    </div>
  );
}
