import { ReminderBell } from "@/features/deadline-rules/reminders";
import { bookingNavigation } from "@/features/navigation/booking-navigation";
import { Link, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { FolderOpen, Bot, ArrowLeft, CalendarDays, House, Inbox, MailQuestion, MapPinned, ClipboardList, Megaphone, MessageSquare, Palette, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import { AddMenu, AppMenu, getAppMenuSearchItems } from "./app-menu";
import { MobileBottomNav } from "./mobile-bottom-nav";
import { ToolFinder } from "./tool-finder";
import { MessageBubbleLink } from "./message-bubble-link";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { AssistantLauncher } from "@/components/assistant/assistant-launcher";
import { AssistantNavigationContextSync } from "@/components/assistant/assistant-navigation-context-sync";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { rememberProfileOrigin } from "@/lib/profile-navigation";
import type { OfficeCoordinatorAttentionData } from "@/components/today/office-coordinator-attention";
import { apiGet } from "@/lib/auth-token";
import { adminWorkspaceForPath, readBookingReturnPath, type AdminWorkspace } from "@/lib/admin-workspace";
import { IncomingCallingProvider } from "@/features/calls/incoming-calling-context";
import { IncomingAvailabilityControl } from "@/components/calls/incoming-availability-control";
import { IncomingCallPanel } from "@/components/calls/incoming-call-panel";

type PrimaryNavigationItem = { href: string; label: string; icon: LucideIcon; keywords?: readonly string[] };

const AssistantDrawer = lazy(() => import("@/components/assistant/assistant-drawer").then(({ AssistantDrawer }) => ({ default: AssistantDrawer })));
const OfficeCoordinatorAttention = lazy(() => import("@/components/today/office-coordinator-attention").then(({ OfficeCoordinatorAttention }) => ({ default: OfficeCoordinatorAttention })));
const OfficeUpdateHistory = lazy(() => import("@/components/office-admin/office-update-history").then(({ OfficeUpdateHistory }) => ({ default: OfficeUpdateHistory })));

function primaryNavigation(workspace: AdminWorkspace, bookingReturnPath: string | null): PrimaryNavigationItem[] {
  if (workspace === "booking") {
    const icons = { home: House, profiles: UsersRound, emails: Inbox, websiteInquiries: MailQuestion, schedule: CalendarDays, documents: FolderOpen };
    return bookingNavigation().map(item => ({ ...item, icon: icons[item.icon] }));
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
      { href: "/design-studio", label: "Design Studio", icon: Palette },
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
  const searchItems = [
    ...primaryItems.map(item => ({ href: item.href, label: item.label, category: "Workspace", keywords: item.keywords ? [...item.keywords] : undefined })),
    ...getAppMenuSearchItems(workspace),
  ];
  const [assistantRequested, setAssistantRequested] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [websiteInquiryCount, setWebsiteInquiryCount] = useState(0);
  const [pendingEmailReviewCount, setPendingEmailReviewCount] = useState(0);
  const [officeAttention, setOfficeAttention] = useState<OfficeCoordinatorAttentionData | null>(null);
  const immersiveProfile = location.startsWith("/profiles/") || location.startsWith("/event-profiles/");
  const assistantWorkspace = location === "/assistant/workspace" || location.startsWith("/assistant/workspace/");
  const showWorkspaceNavigation = primaryItems.length > 0;

  useEffect(() => {
    if (immersiveProfile) return;
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
    const id = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(id); };
  }, [immersiveProfile]);

  useEffect(() => {
    if (immersiveProfile) return;
    let active = true;
    const refresh = () =>
      apiGet<{ newCount: number }>("/website-inquiries/count")
        .then((data) => { if (active) setWebsiteInquiryCount(data.newCount ?? 0); })
        .catch(() => {});
    void refresh();
    const id = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(id); };
  }, [immersiveProfile]);

  useEffect(() => {
    if (immersiveProfile) return;
    let active = true;
    const refresh = () =>
      apiGet<{ count: number }>("/google-workspace/validation/review-count")
        .then((data) => {
          if (active) setPendingEmailReviewCount(data.count);
        })
        .catch(() => {});
    const updateFromReview = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      if (active && Number.isFinite(count)) setPendingEmailReviewCount(count);
    };
    void refresh();
    const id = window.setInterval(refresh, 120000);
    window.addEventListener("email-review-count-changed", updateFromReview);
    return () => {
      active = false;
      window.clearInterval(id);
      window.removeEventListener("email-review-count-changed", updateFromReview);
    };
  }, [immersiveProfile]);

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
    <IncomingCallingProvider><div className="min-h-[100dvh] bg-background text-foreground print:min-h-0">
      <AssistantNavigationContextSync />
      {showWorkspaceNavigation ? (
        <aside className="fixed inset-y-0 left-0 z-20 hidden w-60 flex-col bg-sidebar px-3 py-5 text-sidebar-foreground print:hidden md:flex">
          <div className="mb-6 flex items-center gap-3 px-2">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <UsersRound className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold uppercase tracking-wide">Adventure Zone</p>
              <p className="truncate text-xs text-sidebar-foreground/70">Festival workbench</p>
            </div>
          </div>
          <div className="mb-4 px-1">
            <ToolFinder items={searchItems} />
          </div>
          <nav aria-label="Main navigation" className="grid content-start gap-1">
            {primaryItems.map((item) => {
              const active = location === item.href || location.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-semibold transition",
                    active
                      ? "bg-secondary text-secondary-foreground"
                      : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                  data-testid={`nav-${item.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`}
                  href={item.href}
                  key={`${item.label}:${item.href}`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.href === "/website-inquiries" && websiteInquiryCount > 0 ? (
                    <span aria-label={`${websiteInquiryCount} new inquiries`} className="ml-auto rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                      {websiteInquiryCount > 99 ? "99+" : websiteInquiryCount}
                    </span>
                  ) : null}
                  {item.href === "/emails" && pendingEmailReviewCount > 0 ? (
                    <span aria-label={`${pendingEmailReviewCount} pending email reviews`} className="ml-auto rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950">
                      {pendingEmailReviewCount > 99 ? "99+" : pendingEmailReviewCount}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
        </aside>
      ) : null}
      <div className={cn("min-w-0 overflow-x-clip", showWorkspaceNavigation && "md:ml-60")}>
      {!immersiveProfile ? (
        <header data-assistant-shell-header className="sticky top-0 z-20 hidden border-b border-border bg-card/95 backdrop-blur md:block print:hidden">
          <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 lg:px-6">
            <WorkspaceSwitcher workspace={workspace} />
            {!showWorkspaceNavigation ? (
              <div className="ml-auto w-full max-w-sm">
                <ToolFinder items={searchItems} />
              </div>
            ) : null}
            <div className={cn("flex items-center gap-1.5", showWorkspaceNavigation && "ml-auto")}>
              {workspace === "booking" ? <IncomingAvailabilityControl /> : null}
              <ReminderBell />
              {workspace === "booking" ? <AddMenu /> : null}
              <AppMenu workspace={workspace} unreadMessages={unreadMessages} websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} />
            </div>
          </div>
        </header>
      ) : null}

      {workspace === "operations" ? (
        <div className="fixed right-4 top-4 z-30 md:hidden print:hidden">
          <MessageBubbleLink href="/manager-communications" label="Messages" unreadCount={unreadMessages} />
        </div>
      ) : null}

      <div className="flex justify-end px-3 pt-2 md:hidden print:hidden"><ReminderBell /></div>
      <main className={cn("min-h-[100dvh] min-w-0 px-3 py-4 pb-32 md:min-h-screen md:px-8 md:py-7 md:pb-8 print:min-h-0 print:p-0", assistantWorkspace && "md:px-4 md:py-4")}>
        {location === "/today" ? <Suspense fallback={null}><div className="mx-auto mb-6 max-w-5xl"><OfficeCoordinatorAttention attention={officeAttention} /></div></Suspense> : null}
        {children}
        <div className="print:hidden"><IncomingCallPanel /></div>
        {location.startsWith("/office-coordinator") ? <Suspense fallback={null}><OfficeUpdateHistory /></Suspense> : null}
      </main>

      {assistantRequested ? <div className="print:hidden"><Suspense fallback={null}><AssistantDrawer /></Suspense></div> : null}
      {!immersiveProfile ? <div className="print:hidden"><MobileBottomNav workspace={workspace} websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} searchItems={searchItems} /></div> : null}
      </div>
    </div></IncomingCallingProvider>
  );
}

