import { Link, useLocation } from "wouter";
import { CalendarDays, ContactRound, House } from "lucide-react";
import { AppMenu } from "./app-menu";

const primaryItems = [
  { href: "/today", label: "Today", icon: House },
  { href: "/profiles", label: "Profiles", icon: ContactRound },
  { href: "/schedule", label: "Schedule", icon: CalendarDays },
];

export function MobileBottomNav() {
  const [location] = useLocation();

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_14px_rgba(15,23,42,0.08)] md:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 gap-1">
        {primaryItems.map((item) => {
          const active = location === item.href || location.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold transition ${active ? "bg-orange-50 text-orange-700" : "text-slate-700 hover:bg-slate-100"}`}
              href={item.href}
              key={item.href}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          );
        })}
        <AppMenu mobile />
      </div>
    </nav>
  );
}
