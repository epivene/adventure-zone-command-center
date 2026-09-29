import { Link, useLocation } from "wouter";
import { Bot, ArrowLeft, CalendarDays, ContactRound, House, LayoutGrid, MapPinned, Megaphone, MessageSquare, UsersRound, type LucideIcon } from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import { AppMenu } from "./app-menu";
import { readBookingReturnPath, type AdminWorkspace } from "@/lib/admin-workspace";

type MobileItem = { href: string; label: string; icon: LucideIcon };

function itemsForWorkspace(workspace: AdminWorkspace): MobileItem[] {
  if (workspace === "booking") {
    return [
      { href: "/assistant/workspace", label: "Assistant", icon: Bot },
      { href: "/today", label: "Today", icon: House },
      { href: "/profiles", label: "Profiles", icon: ContactRound },
      { href: "/schedule", label: "Schedule", icon: CalendarDays },
    ];
  }
  if (workspace === "operations") {
    return [
      { href: "/command", label: "Panel", icon: LayoutGrid },
      { href: "/operations/legs", label: "Legs", icon: MapPinned },
      { href: "/manager-communications", label: "Comms", icon: MessageSquare },
      { href: "/manager-crew", label: "Crew", icon: UsersRound },
    ];
  }
  if (workspace === "marketing") {
    const bookingReturnPath = readBookingReturnPath();
    return [
      { href: "/command", label: "Panel", icon: LayoutGrid },
      { href: "/marketing", label: "Marketing", icon: Megaphone },
      ...(bookingReturnPath ? [{ href: bookingReturnPath, label: "Booking", icon: ArrowLeft }] : []),
    ];
  }
  return [{ href: "/command", label: "Panel", icon: LayoutGrid }];
}

export function MobileBottomNav({
  workspace,
  websiteInquiryCount = 0,
  pendingEmailReviewCount = 0,
}: {
  workspace: AdminWorkspace;
  websiteInquiryCount?: number;
  pendingEmailReviewCount?: number;
}) {
  const [location] = useLocation();
  const primaryItems = itemsForWorkspace(workspace);

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_14px_rgba(15,23,42,0.08)] md:hidden"
    >
      <div className="mx-auto grid max-w-lg gap-1" style={{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }}>
        {primaryItems.map((item) => {
          const active = location === item.href || (item.href.startsWith("/") && location.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold transition",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              href={item.href}
              key={`${item.label}:${item.href}`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <AppMenu workspace={workspace} mobile websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} />
      </div>
    </nav>
  );
}
