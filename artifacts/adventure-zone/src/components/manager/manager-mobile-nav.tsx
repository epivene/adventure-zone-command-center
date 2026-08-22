import { Link, useLocation } from "wouter";
import { Home, MapPinned, WalletCards, UsersRound } from "lucide-react";
import { ManagerMenu } from "./manager-menu";

const items = [
  { href: "/manager", label: "Home", icon: Home },
  { href: "/manager/route", label: "Schedule", icon: MapPinned },
  { href: "/manager/money", label: "Money", icon: WalletCards },
  { href: "/manager/crew", label: "Crew", icon: UsersRound },
];

export function ManagerMobileNav({ unreadMessages, onSignOut }: { unreadMessages: number; onSignOut(): void }) {
  const [location] = useLocation();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 text-card-foreground pb-[max(0.25rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto grid max-w-3xl grid-cols-5">
        {items.map((item) => {
          const active = item.href === "/manager" ? location === "/manager" : location === item.href || location.startsWith(`${item.href}/`);
          const Icon = item.icon;
          return <Link aria-current={active ? "page" : undefined} href={item.href} key={item.href} className={`flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-semibold ${active ? "text-orange-700" : "text-muted-foreground"}`}><Icon className="h-5 w-5" />{item.label}</Link>;
        })}
        <ManagerMenu unreadMessages={unreadMessages} onSignOut={onSignOut} />
      </div>
    </nav>
  );
}
