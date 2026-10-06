import { bookingNavigation } from "@/features/navigation/booking-navigation";
import { Link, useLocation } from "wouter";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Bot, ArrowLeft, CalendarDays, House, Inbox, MailQuestion, MapPinned, ClipboardList, Megaphone, MessageSquare, Palette, UsersRound, type LucideIcon } from "lucide-react";
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
import { IncomingCallingProvider } from "@/features/calls/incoming-calling-context";
import { IncomingAvailabilityControl } from "@/components/calls/incoming-availability-control";
import { IncomingCallPanel } from "@/components/calls/incoming-call-panel";
import { getGoogleWorkspaceValidationReview } from "@/features/google-workspace/google-workspace-client";

type PrimaryNavigationItem = { href: string; label: string; icon: LucideIcon };

const AssistantDrawer = lazy(() => import("@/components/assistant/assistant-drawer").then(({ AssistantDrawer }) => ({ default: AssistantDrawer })));
const OfficeCoordinatorAttention = lazy(() => import("@/components/today/office-coordinator-attention").then(({ OfficeCoordinatorAttention }) => ({ default: OfficeCoordinatorAttention })));
const OfficeUpdateHistory = lazy(() => import("@/components/office-admin/office-update-history").then(({ OfficeUpdateHistory }) => ({ default: OfficeUpdateHistory })));

function primaryNavigation(workspace: AdminWorkspace, bookingReturnPath: string | null): PrimaryNavigationItem[] {
  if (workspace === "booking") {
    const icons = { home: House, profiles: UsersRound, emails: Inbox, schedule: CalendarDays };
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
  const [assistantRequested, setAssistantRequested] = useState(false);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [websiteInquiryCount, setWebsiteInquiryCount] = useState(0);
  const [pendingEmailReviewCount, setPendingEmailReviewCount] = useState(0);
  const [officeAttention, setOfficeAttention] = useState<OfficeCoordinatorAttentionData | null>(null);
  const immersiveProfile = location.startsWith("/profiles/") || location.startsWith("/event-profiles/");
  const assistantWorkspace = location === "/assistant/workspace" || location.startsWith("/assistant/workspace/");

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
      getGoogleWorkspaceValidationReview()
        .then((data) => {
          if (active) setPendingEmailReviewCount(data.items.filter((item) => item.state === "pending").length);
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
      {!immersiveProfile ? (
        <header data-assistant-shell-header className="sticky top-0 z-20 hidden border-b border-border bg-card/95 backdrop-blur md:block print:hidden">
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
                        "relative inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition lg:px-3",
                        active
                          ? "bg-secondary text-secondary-foreground"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                      href={item.href}
                      key={`${item.label}:${item.href}`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="hidden lg:inline">{item.label}</span>
                      {item.href === "/website-inquiries" && websiteInquiryCount > 0 ? (
                        <span aria-label={`${websiteInquiryCount} new inquiries`} className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                          {websiteInquiryCount > 99 ? "99+" : websiteInquiryCount}
                        </span>
                      ) : null}
                      {item.href === "/emails" && pendingEmailReviewCount > 0 ? (
                        <span aria-label={`${pendingEmailReviewCount} pending email reviews`} className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950">
                          {pendingEmailReviewCount > 99 ? "99+" : pendingEmailReviewCount}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </nav>
            ) : null}
            <div className="ml-auto flex items-center gap-1.5">
              {workspace === "booking" ? <IncomingAvailabilityControl /> : null}
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

      <main className={cn("min-h-screen px-3 py-4 pb-24 md:px-8 md:py-7 md:pb-8 print:min-h-0 print:p-0", assistantWorkspace && "md:px-4 md:py-4")}>
        {location === "/today" ? <Suspense fallback={null}><div className="mx-auto mb-6 max-w-5xl"><OfficeCoordinatorAttention attention={officeAttention} /></div></Suspense> : null}
        {children}
        <div className="print:hidden"><IncomingCallPanel /></div>
        {location.startsWith("/office-coordinator") ? <Suspense fallback={null}><OfficeUpdateHistory /></Suspense> : null}
      </main>

      {assistantRequested ? <div className="print:hidden"><Suspense fallback={null}><AssistantDrawer /></Suspense></div> : null}
      {!immersiveProfile ? <div className="print:hidden"><MobileBottomNav workspace={workspace} websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} /></div> : null}
    </div></IncomingCallingProvider>
  );
}
