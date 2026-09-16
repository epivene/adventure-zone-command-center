import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  Building2,
  Calendar,
  Check,
  ClipboardCheck,
  Gamepad2,
  House,
  Menu as MenuIcon,
  Moon,
  Palette,
  Receipt,
  FileSignature,
  Star,
  Sun,
  Wrench,
} from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";
import { useBossAuth } from "@/lib/boss-auth-context";
import { readAppearance, saveAppearance, type Appearance } from "@/lib/appearance";

type NavItem = { href: string; label: string; icon: typeof House };

const navItems: NavItem[] = [
  { href: "/boss", label: "Home", icon: House },
  { href: "/boss/schedule", label: "Schedule", icon: Calendar },
  { href: "/boss/profiles", label: "Profiles", icon: Building2 },
  { href: "/boss/conventions?view=game", label: "Convention Game", icon: Gamepad2 },
  { href: "/boss/receipts", label: "Receipts", icon: Receipt },
  { href: "/boss/reviews", label: "Reviews", icon: Star },
  { href: "/boss/maintenance", label: "Maintenance", icon: Wrench },
  { href: "/boss/templates-files", label: "Documents", icon: ClipboardCheck },
  { href: "/boss/invoices-contracts", label: "Invoices & Contracts", icon: FileSignature },
];

const appearanceOptions = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

function NavLink({ item, mobile = false }: { item: NavItem; mobile?: boolean }) {
  const [location] = useLocation();
  const itemPath = item.href.split("?")[0];
  const active = itemPath === "/boss"
    ? location === "/boss" || location === "/boss/"
    : location.startsWith(itemPath);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        mobile
          ? cn(
              "relative flex min-h-14 min-w-[4rem] flex-1 flex-col items-center justify-center rounded-lg px-1 text-[10px] font-semibold gap-0.5",
              active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )
          : cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
              active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            ),
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className={mobile ? "leading-tight text-center" : ""}>{item.label}</span>
    </Link>
  );
}

function AppearanceMenu({ onSignOut }: { onSignOut(): void }) {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());

  function choose(value: Appearance) {
    saveAppearance(value);
    setAppearance(value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Appearance"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          type="button"
        >
          <Palette className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {appearanceOptions.map((opt) => {
          const Icon = opt.icon;
          return (
            <DropdownMenuItem key={opt.value} onSelect={() => choose(opt.value)}>
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{opt.label}</span>
              {appearance === opt.value ? <Check className="h-4 w-4 text-primary" aria-label="Selected" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="sm:hidden" onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BossNavigationMenu() {
  const [location] = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-semibold text-foreground shadow-sm hover:bg-muted"
          type="button"
        >
          <MenuIcon className="h-4 w-4" /> Menu
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Boss navigation</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {navItems.map((item) => {
          const Icon = item.icon;
          const itemPath = item.href.split("?")[0];
          const active = itemPath === "/boss"
            ? location === "/boss" || location === "/boss/"
            : location.startsWith(itemPath);
          return (
            <DropdownMenuItem asChild key={item.href}>
              <Link
                aria-current={active ? "page" : undefined}
                className={active ? "bg-secondary text-secondary-foreground" : undefined}
                href={item.href}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function BossShell({ children }: { children: ReactNode }) {
  const { boss, signOut } = useBossAuth();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground print:min-h-0">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur print:hidden">
        <div className="mx-auto max-w-7xl px-4 py-2 md:px-6">
          <div className="flex items-center gap-2">
            <Link href="/boss" className="min-w-0 font-bold text-foreground text-sm leading-tight">
              Adventure Zone
              <span className="ml-1.5 text-xs font-semibold text-primary">Boss</span>
            </Link>
            <div className="ml-auto hidden xl:block"><BossNavigationMenu /></div>
            <AppearanceMenu onSignOut={signOut} />
            <button
              className="button-secondary hidden shrink-0 px-2.5 py-1.5 text-xs sm:inline-flex"
              type="button"
              onClick={signOut}
              data-testid="boss-sign-out"
            >
              Sign out
            </button>
          </div>
          {boss ? (
            <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
              Boss Workspace · {boss.displayName}
            </p>
          ) : null}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 pb-24 md:px-8 md:py-6 xl:pb-8 print:max-w-none print:p-0">{children}</main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 xl:hidden print:hidden">
        <nav aria-label="Boss navigation" className="flex gap-0.5 overflow-x-auto">
          {navItems.map((item) => <NavLink key={item.href} item={item} mobile />)}
        </nav>
      </div>
    </div>
  );
}
