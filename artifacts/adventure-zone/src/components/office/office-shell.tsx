import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Check, ClipboardList, ContactRound, House, Inbox, Mail, MessageCircle, Moon, Palette, Send, Sun, type LucideIcon } from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";
import { officeGet, useOfficeAuth } from "@/lib/office-auth-context";
import { readAppearance, saveAppearance, type Appearance } from "@/lib/appearance";

type OfficeNavItem = { href: string; label: string; icon: LucideIcon };

const items: OfficeNavItem[] = [
  { href: "/office", label: "Today", icon: House },
  { href: "/office/profiles", label: "Profiles", icon: ContactRound },
  { href: "/office/mail", label: "Brochures", icon: Mail },
  { href: "/office/emails", label: "Emails", icon: Send },
  { href: "/office/tasks", label: "Tasks", icon: ClipboardList },
  { href: "/office/messages", label: "Messages", icon: MessageCircle },
];
const inquiryItem: OfficeNavItem = { href: "/office/website-inquiries", label: "Website Inquiries", icon: Inbox };

const appearanceOptions = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

function Nav({ mobile = false, unread = 0, canReviewWebsiteInquiries = false, websiteInquiryCount = 0 }: { mobile?: boolean; unread?: number; canReviewWebsiteInquiries?: boolean; websiteInquiryCount?: number }) {
  const [location] = useLocation();
  const visibleItems = canReviewWebsiteInquiries ? [items[0]!, inquiryItem, ...items.slice(1)] : items;
  return (
    <nav aria-label="Office Coordinator navigation" className={mobile ? "flex gap-1 overflow-x-auto" : "flex items-center gap-1"}>
      {visibleItems.map(({ href, label, icon: Icon }) => {
        const active = href === "/office" ? location === href : location.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "relative",
              mobile
                ? cn(
                    "relative flex min-h-14 min-w-[4.25rem] flex-1 flex-col items-center justify-center rounded-lg px-1 text-[10px] font-semibold",
                    active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )
                : cn(
                    "inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold",
                    active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ),
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{label}</span>
            {label === "Messages" && unread > 0 ? (
              <span className="absolute right-1 top-1 rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
            {label === "Website Inquiries" && websiteInquiryCount > 0 ? (
              <span className="absolute right-1 top-1 rounded-full bg-orange-600 px-1 text-[9px] font-bold text-white">
                {websiteInquiryCount > 99 ? "99+" : websiteInquiryCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function OfficeAppearanceMenu({ onSignOut }: { onSignOut(): void }) {
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());

  function chooseAppearance(value: Appearance) {
    saveAppearance(value);
    setAppearance(value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Appearance"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
          type="button"
        >
          <Palette className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Appearance</DropdownMenuLabel>
        {appearanceOptions.map((option) => {
          const Icon = option.icon;
          return (
            <DropdownMenuItem key={option.value} onSelect={() => chooseAppearance(option.value)}>
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{option.label}</span>
              {appearance === option.value ? <Check aria-label="Selected" className="h-4 w-4 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="sm:hidden" onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function OfficeShell({ children }: { children: ReactNode }) {
  const { office, signOut } = useOfficeAuth();
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [unread, setUnread] = useState(0);
  const [websiteInquiryCount, setWebsiteInquiryCount] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      officeGet<{ unreadMessages: number }>("/office/today")
        .then((d) => { if (active) setUnread(d.unreadMessages ?? 0); })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!office?.canReviewWebsiteInquiries) {
      setWebsiteInquiryCount(0);
      return;
    }
    let active = true;
    const load = () =>
      officeGet<{ newCount: number }>("/website-inquiries/count")
        .then((data) => { if (active) setWebsiteInquiryCount(data.newCount ?? 0); })
        .catch(() => {});
    void load();
    const id = window.setInterval(load, 15000);
    return () => { active = false; window.clearInterval(id); };
  }, [office?.canReviewWebsiteInquiries]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const q = search.trim();
    setLocation(q ? `/office/profiles?q=${encodeURIComponent(q)}` : "/office/profiles");
  }

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 md:px-6">
          <div className="flex items-center gap-2">
            <Link href="/office" className="min-w-0 flex-1 truncate font-bold text-foreground">
              Adventure Zone{" "}
              <span className="ml-1 text-sm font-semibold text-primary">Office Coordinator</span>
            </Link>
            <div className="ml-auto hidden xl:block"><Nav unread={unread} canReviewWebsiteInquiries={office?.canReviewWebsiteInquiries} websiteInquiryCount={websiteInquiryCount} /></div>
            <OfficeAppearanceMenu onSignOut={signOut} />
            <button className="button-secondary hidden shrink-0 px-2.5 py-1.5 text-xs sm:inline-flex" type="button" onClick={signOut}>
              Sign out
            </button>
          </div>
          <form className="mt-3 flex gap-2 md:mt-2" onSubmit={submit}>
            <input
              aria-label="Search profiles"
              className="min-w-0 flex-1"
              placeholder="Search profiles, contacts, cities…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button className="button-secondary shrink-0" type="submit">Search</button>
          </form>
          {office ? <p className="mt-1 truncate text-xs text-muted-foreground">Booking Workspace · {office.displayName}</p> : null}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-4 pb-24 md:px-8 md:py-7 xl:pb-8">{children}</main>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-1 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 xl:hidden">
        <Nav mobile unread={unread} canReviewWebsiteInquiries={office?.canReviewWebsiteInquiries} websiteInquiryCount={websiteInquiryCount} />
      </div>
    </div>
  );
}
