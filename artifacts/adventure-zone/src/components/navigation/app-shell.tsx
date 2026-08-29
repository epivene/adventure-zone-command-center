import { Link, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CalendarDays, ContactRound, House, MapPinned, Megaphone, MessageSquare, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import { AddMenu, AppMenu } from "./app-menu";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { MessageBubbleLink } from "./message-bubble-link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantNavigationContextSync } from "@/components/assistant/assistant-navigation-context-sync";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { rememberProfileOrigin } from "@/lib/profile-navigation";
import type { OfficeCoordinatorAttentionData } from "@/components/today/office-coordinator-attention";
import { apiGet } from "@/lib/auth-token";
import { adminWorkspaceForPath, readBookingReturnPath, type AdminWorkspace } from "@/lib/admin-workspace";

type PrimaryNavigationItem = { href: string; label: string; icon: LucideIcon };

const AssistantDrawer = lazy(() => import("@/components/assistant/assistant-drawer").then(({ AssistantDrawer }) => ({ default: AssistantDrawer })));
const OfficeCoordinatorAttention = lazy(() => import("@/components/today/office-coordinator-attention").then(({ OfficeCoordinatorAttention }) => ({ default: OfficeCoordinatorAttention })));
const OfficeUpdateHistory = lazy(() => import("@/components/office-admin/office-update-history").then(({ OfficeUpdateHistory }) => ({ default: OfficeUpdateHistory })));

function primaryNavigation(workspace: AdminWorkspace, bookingReturnPath: string | null): PrimaryNavigationItem[] {
  if (workspace === "booking") {
    return [
      { href: "/today", label: "Today", icon: House },
      { href: "/bookings", label: "Bookings", icon: UsersRound },
      { href: "/profiles", label: "Profiles", icon: ContactRound },
      { href: "/calls/workspace", label: "Calls", icon: MessageSquare },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
      { href: "/research-sources", label: "Research", icon: Megaphone },
    ];
  }
  if (workspace === "operations") {
    return [
      { href: "/operations/legs", label: "Leg management", icon: MapPinned },
      { href: "/manager-communications", label: "Communications", icon: MessageSquare },
      { href: "/manager-crew", label: "Crew", icon: UsersRound },
    ];
  }
  if (workspace === "marketing") {
    return [
      { href: "/marketing", label: "Marketing Home", icon: Megaphone },
      ...(bookingReturnPath ? [{ href: bookingReturnPath, label: "Back to Booking", icon: ArrowLeft }] : []),
    ];
  }
  return [];
}

export function AppShell({ children }: { children: ReactNode }) {
  const { isOpen } = useAssistantContext();
  const [location] = useLocation();
  const workspace = adminWorkspaceForPath(location);
  const bookingReturnPath = workspace === "marketing" ? readBookingReturnPath() : null;
  const primaryItems = primaryNavigation(workspace, bookingReturnPath);
  const [assistantRequested, setAssistantRequested] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [officeAttention, setOfficeAttention] = useState<OfficeCoordinatorAttentionData | null>(null);
  const immersiveProfile = location.startsWith("/profiles/") || location.startsWith("/event-profiles/");

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
    if (!immersiveProfile) rememberProfileOrigin(location);
  }, [immersiveProfile, location]);

  useEffect(() => {
    if (isOpen) setAssistantRequested(true);
  }, [isOpen]);

  useEffect(() => {
    let active = true;
    if (location !== "/today") { setOfficeAttention(null); return; }
    apiGet<{ officeCoordinatorAttention?: OfficeCoordinatorAttentionData }>("/today")
      .then((data) => { if (active) setOfficeAttention(data.officeCoordinatorAttention ?? null); })
      .catch(() => { if (active) setOfficeAttention(null); });
    return () => { active = false; };
  }, [location]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <AssistantNavigationContextSync />
      {!immersiveProfile ? (
        <header className="sticky top-0 z-20 hidden border-b border-border bg-card/95 backdrop-blur md:block">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 lg:px-6">
            <WorkspaceSwitcher workspace={workspace} />
            {primaryItems.length ? (
              <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-1">
                {primaryItems.map((item) => {
                  const active = location === item.href || (item.href.startsWith("/") && location.startsWith(`${item.href}/`));
                  const Icon = item.icon;
                  return (
                    <Link
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition lg:px-3",
                        active
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      href={item.href}
                      key={`${item.label}:${item.href}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="hidden lg:inline">{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              <MessageBubbleLink
                className="rounded-lg shadow-none"
                href="/manager-communications"
                label="Messages"
                unreadCount={unreadMessages}
              />
              <AssistantLauncher placement="toolbar" />
              {workspace === "booking" ? <AddMenu /> : null}
              <AppMenu workspace={workspace} />
            </div>
          </div>
        </header>
      ) : null}

      {workspace === "operations" ? (
        <div className="fixed right-4 top-4 z-30 md:hidden">
          <MessageBubbleLink href="/manager-communications" label="Messages" unreadCount={unreadMessages} />
        </div>
      ) : null}

      <main className="min-h-screen px-4 py-5 pb-28 md:px-8 md:py-7 md:pb-8">
        {location === "/today" ? <Suspense fallback={null}><div className="mx-auto mb-6 max-w-5xl"><OfficeCoordinatorAttention attention={officeAttention} /></div></Suspense> : null}
        {children}
        {location.startsWith("/office-coordinator") ? <Suspense fallback={null}><OfficeUpdateHistory /></Suspense> : null}
      </main>

      {!immersiveProfile ? <AssistantLauncher placement="floating" /> : null}
      {assistantRequested ? <Suspense fallback={null}><AssistantDrawer /></Suspense> : null}
      {!immersiveProfile ? <MobileBottomNav workspace={workspace} /> : null}
    </div>
  );
}
