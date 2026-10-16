import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Bot, Check, ChevronDown, Ellipsis, Moon, Palette, Plus, Sun } from "lucide-react";
import { cn } from "@workspace/avz-crm/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";
import { readAppearance, saveAppearance, type Appearance } from "@/lib/appearance";
import { saveBookingReturnPath, type AdminWorkspace } from "@/lib/admin-workspace";
import { useAssistantContext } from "@/features/assistant/assistant-context";
import { apiGet } from "@/lib/auth-token";
import { ToolFinder, type ToolFinderItem } from "./tool-finder";

type MenuItem = { href: string; label: string; rememberBookingBeforeOpen?: boolean; badgeCount?: number; keywords?: string[] };
type MenuGroup = { label: string; items: MenuItem[] };

const bookingItems: MenuItem[] = [
  { href: "/profiles", label: "Profiles" },
  { href: "/dave-requests", label: "Dave Requests" },
  { href: "/emails", label: "Emails" },
  { href: "/website-inquiries", label: "Website Inquiries", keywords: ["web", "inquiry", "inquiries", "website form", "contact form", "lead"] },
  { href: "/emails?view=review", label: "Emails needing review" },
  { href: "/calls/workspace", label: "Calls" },
  { href: "/calls/voicemail", label: "Voicemail" },
  { href: "/boss-access", label: "Boss Access" },
  { href: "/research-sources", label: "Research Sources" },
  { href: "/needs-answer", label: "Needs Answer" },
];

const bookingToolsGroups: MenuGroup[] = [
  { label: "Booking tools", items: bookingItems.filter(item => item.href !== "/website-inquiries") },
];

const operationsGroups: MenuGroup[] = [
  {
    label: "Legs & Operations",
    items: [
      { href: "/operations/legs", label: "Leg management" },
      { href: "/manager-communications", label: "Communications" },
      { href: "/manager-finance", label: "Finances" },
      { href: "/manager-crew", label: "Crew" },
      { href: "/manager-aftermath", label: "Reviews & incidents" },
      { href: "/manager-issues", label: "Route issues" },
    ],
  },
];

const marketingGroups: MenuGroup[] = [
  {
    label: "Marketing",
    items: [
      { href: "/marketing", label: "Marketing home" },
      { href: "/design-studio", label: "Design Studio" },
    ],
  },
];

const adminToolsGroups: MenuGroup[] = [
  {
    label: "Review queues",
    items: [
      { href: "/emails", label: "Emails" },
  { href: "/emails?view=review", label: "Emails needing review" },
    ],
  },
  {
    label: "Data & Imports",
    items: [
      { href: "/settings/paper-notes", label: "Paper notes" },
      { href: "/settings/act-migration", label: "ACT! import" },
      { href: "/settings/act-recovery", label: "ACT Recovery" },
      { href: "/imports/attendance-history", label: "Attendance history" },
    ],
  },
  {
    label: "Business Setup",
    items: [
      { href: "/settings/business-sources", label: "Business sources" },
      { href: "/settings/tax-receipts", label: "Tax & receipts", keywords: ["tax", "Venmo", "receipt", "booking agent", "income", "expense", "1099", "pay owed", "weekly pay", "self-employment", "tax estimate", "North Dakota"] },
      { href: "/settings/coi", label: "Certificates of insurance" },
      { href: "/settings/packages-resources", label: "Packages & resources" },
      { href: "/settings/call-scripts", label: "Call scripts" },
      { href: "/settings/communication-templates", label: "Email templates" },
    ],
  },
  {
    label: "Connections",
    items: [
      { href: "/settings/google-workspace", label: "Google Workspace" },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/settings", label: "Settings" },
    ],
  },
];

const appearanceOptions = [
  { value: "light" as const, label: "Light", icon: Sun },
  { value: "dark" as const, label: "Dark", icon: Moon },
];

function groupsForWorkspace(workspace: AdminWorkspace): MenuGroup[] {
  if (workspace === "booking") return bookingToolsGroups;
  if (workspace === "operations") return operationsGroups;
  if (workspace === "marketing") return marketingGroups;
  return [];
}

export function getAppMenuSearchItems(workspace: AdminWorkspace): ToolFinderItem[] {
  const groups = workspace === "command" ? [] : [...groupsForWorkspace(workspace), ...adminToolsGroups];
  const groupedItems = groups.flatMap(group => group.items.map(item => ({
    href: item.href,
    label: item.label,
    keywords: item.keywords,
    category: group.label,
  })));
  const mobileBookingSearchItems: ToolFinderItem[] = workspace === "booking"
    ? bookingItems
      .filter(item => item.href === "/website-inquiries")
      .map(item => ({ ...item, category: "Booking tools" }))
    : [];
  const commonItems: ToolFinderItem[] = [
    { href: "/business-documents", label: "All documents", category: "Documents", keywords: ["files", "insurance", "COI"] },
    { href: "/invoices-contracts", label: "Contracts & Invoices", category: "Documents", keywords: ["invoice", "contract"] },
    { href: "/manager-communications", label: "Messages", category: "Communication", keywords: ["message", "communications"] },
    { href: "/assistant/workspace", label: "Assistant workspace", category: "Tools", keywords: ["assistant", "help"] },
  ];
  const uniqueItems = new Map<string, ToolFinderItem>();
  for (const item of [...groupedItems, ...mobileBookingSearchItems, ...commonItems]) {
    if (!uniqueItems.has(item.href)) uniqueItems.set(item.href, item);
  }
  return [...uniqueItems.values()];
}

export function AddMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Add"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          type="button"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden xl:inline">Add</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild><Link href="/event-profiles/new">Add a New Profile</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/profiles">Find a Profile</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
         <DropdownMenuItem asChild><Link href="/calls/workspace?mode=add">New caller</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/contacts/new">Add a New Contact</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/contacts">Find a Contact</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuLink({
  item,
  workspace,
  location,
  websiteInquiryCount = 0,
  pendingEmailReviewCount = 0,
}: {
  item: MenuItem;
  workspace: AdminWorkspace;
  location: string;
  websiteInquiryCount?: number;
  pendingEmailReviewCount?: number;
}) {
  const active = location === item.href || location.startsWith(`${item.href}/`);
  const ariaLabel = item.href === "/website-inquiries" && websiteInquiryCount > 0
    ? `Website Inquiries, ${websiteInquiryCount} new`
    : item.href === "/emails?view=review" && pendingEmailReviewCount > 0
      ? `Email Review, ${pendingEmailReviewCount} pending`
      : item.badgeCount ? `${item.label}, ${item.badgeCount} pending` : undefined;
  return (
    <DropdownMenuItem asChild className={cn(active && "bg-secondary font-semibold text-secondary-foreground")}>
      <Link
        aria-label={ariaLabel}
        href={item.href}
        onClick={() => {
          if (item.rememberBookingBeforeOpen && workspace === "booking") saveBookingReturnPath(location);
        }}
      >
        <span className="flex-1">{item.label}</span>
        {item.href === "/website-inquiries" && websiteInquiryCount > 0 ? (
          <span className="rounded-full bg-orange-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {websiteInquiryCount > 99 ? "99+" : websiteInquiryCount}
          </span>
        ) : null}
        {item.href === "/emails?view=review" && pendingEmailReviewCount > 0 ? (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950">
            {pendingEmailReviewCount > 99 ? "99+" : pendingEmailReviewCount}
          </span>
        ) : null}
        {item.badgeCount ? (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950">
            {item.badgeCount > 99 ? "99+" : item.badgeCount}
          </span>
        ) : null}
      </Link>
    </DropdownMenuItem>
  );
}

function MenuSubmenu({
  label,
  groups,
  workspace,
  location,
  nestedGroups = false,
  websiteInquiryCount = 0,
  pendingEmailReviewCount = 0,
}: {
  label: string;
  groups: MenuGroup[];
  workspace: AdminWorkspace;
  location: string;
  nestedGroups?: boolean;
  websiteInquiryCount?: number;
  pendingEmailReviewCount?: number;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="rounded-md px-2 py-2 text-sm font-semibold">
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        {groups.map((group) =>
          nestedGroups ? (
            <DropdownMenuSub key={group.label}>
              <DropdownMenuSubTrigger className="rounded-md px-2 py-2 text-sm font-semibold">
                {group.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-60">
                {group.items.map((item) => (
                  <MenuLink
                    item={item}
                    workspace={workspace}
                    location={location}
                    websiteInquiryCount={websiteInquiryCount}
                    pendingEmailReviewCount={pendingEmailReviewCount}
                    key={`${group.label}:${item.href}:${item.label}`}
                  />
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            group.items.map((item) => (
              <MenuLink
                item={item}
                workspace={workspace}
                location={location}
                websiteInquiryCount={websiteInquiryCount}
                pendingEmailReviewCount={pendingEmailReviewCount}
                key={`${group.label}:${item.href}:${item.label}`}
              />
            ))
          ),
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function AppearanceChoices({ appearance, onChange }: { appearance: Appearance; onChange: (value: Appearance) => void }) {
  return (
    <div className="py-1">
      <div className="flex items-center gap-2 px-2 py-2 text-sm font-bold text-foreground">
        <Palette className="h-4 w-4" />
        Appearance
      </div>
      <div className="grid gap-0.5 pl-2">
        {appearanceOptions.map((option) => {
          const Icon = option.icon;
          const selected = appearance === option.value;
          return (
            <DropdownMenuItem key={option.value} onSelect={() => onChange(option.value)}>
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1">{option.label}</span>
              {selected ? <Check aria-label="Selected" className="h-4 w-4 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </div>
    </div>
  );
}

export function AppMenu({
  workspace,
  mobile = false,
  unreadMessages = 0,
  websiteInquiryCount = 0,
  pendingEmailReviewCount = 0,
  searchItems = [],
}: {
  workspace: AdminWorkspace;
  mobile?: boolean;
  unreadMessages?: number;
  websiteInquiryCount?: number;
  pendingEmailReviewCount?: number;
  searchItems?: ToolFinderItem[];
}) {
  const { signOut } = useAuth();
  const { openAssistant } = useAssistantContext();
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());
  const [pendingDocumentReviewCount, setPendingDocumentReviewCount] = useState(0);
  useEffect(() => {
    let active = true;
    const refresh = () => apiGet<{ count: number }>("/business-documents/review-count")
      .then((result) => { if (active) setPendingDocumentReviewCount(result.count); })
      .catch(() => undefined);
    const changed = (event: Event) => {
      const count = (event as CustomEvent<number>).detail;
      if (active && Number.isFinite(count)) setPendingDocumentReviewCount(count);
    };
    void refresh();
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("business-document-review-count-changed", changed);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("business-document-review-count-changed", changed);
    };
  }, []);
  const visibleAdminToolsGroups = adminToolsGroups.map((group) => ({
    ...group,
    items: group.items.map((item) => item.href === "/business-documents" ? { ...item, badgeCount: pendingDocumentReviewCount } : item),
  }));
  const workspaceGroups = groupsForWorkspace(workspace);
  const groups = workspace === "command" ? [] : [...workspaceGroups, ...visibleAdminToolsGroups];
  const bookingMenuItems = bookingItems;

  function chooseAppearance(value: Appearance) {
    saveAppearance(value);
    setAppearance(value);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={pendingEmailReviewCount > 0 ? `More, ${pendingEmailReviewCount} email reviews pending` : "More"}
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
            mobile && "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs",
          )}
          type="button"
        >
          <Ellipsis className="h-5 w-5" />
          <span className={mobile ? "" : "hidden xl:inline"}>More</span>
          {pendingEmailReviewCount > 0 ? (
            <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-amber-950">
              {pendingEmailReviewCount > 99 ? "99+" : pendingEmailReviewCount}
            </span>
          ) : null}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        side={mobile ? "top" : "bottom"}
        className={mobile ? "max-h-[72dvh] w-[min(92vw,22rem)] overflow-y-auto p-2" : "max-h-[76vh] w-72 overflow-y-auto p-2"}
      >
        {mobile ? (
          <>
            <div className="px-1 pb-2 pt-1">
              <ToolFinder items={searchItems} variant="menu" />
            </div>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuLabel>Documents</DropdownMenuLabel>
        <MenuLink item={{ href: "/business-documents", label: "All documents", badgeCount: pendingDocumentReviewCount }} workspace={workspace} location={location} />
        <MenuLink item={{ href: "/invoices-contracts", label: "Contracts & Invoices" }} workspace={workspace} location={location} />
        <DropdownMenuSeparator />
        {!mobile ? (
          <div className="grid gap-0.5 py-1">
            {workspace === "booking" ? (
              <MenuSubmenu
                label="Booking tools"
                groups={bookingToolsGroups}
                workspace={workspace}
                location={location}
                websiteInquiryCount={websiteInquiryCount}
                pendingEmailReviewCount={pendingEmailReviewCount}
              />
            ) : null}
            <DropdownMenuItem asChild className="rounded-md px-2 py-2">
              <Link
                aria-label={unreadMessages ? `Messages, ${unreadMessages} unread` : "Messages"}
                href="/manager-communications"
              >
                <span className="flex-1">Messages</span>
                {unreadMessages > 0 ? (
                  <span
                    aria-label={`${unreadMessages} unread`}
                    className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground"
                  >
                    {unreadMessages > 9 ? "9+" : unreadMessages}
                  </span>
                ) : null}
              </Link>
            </DropdownMenuItem>

          </div>
        ) : null}
            <DropdownMenuItem asChild><Link href="/assistant/workspace" className="rounded-md px-2 py-2"><Bot className="h-4 w-4" />Assistant workspace</Link></DropdownMenuItem>
              <DropdownMenuItem
              aria-label="Older conversations and specialist tools"
              className="rounded-md px-2 py-2"
              onSelect={() => openAssistant()}
            >
              <Bot className="h-4 w-4" />
              Older conversations & tools
            </DropdownMenuItem>
        {mobile && workspace === "booking" ? (
          <div className="grid gap-0.5 py-1">
            {bookingMenuItems.map((item) => <MenuLink item={item} workspace={workspace} location={location} websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} key={`${item.href}:${item.label}`} />)}
          </div>
        ) : null}
        {mobile
          ? groups.map((group) => {
              if (workspace === "booking" && group.label === "Booking tools") return null;
              const isAdminToolGroup = adminToolsGroups.some((adminGroup) => adminGroup.label === group.label);
              const expanded = openGroups[group.label] ?? (!isAdminToolGroup && workspace !== "booking");
              return (
                <div key={group.label} className="py-0.5">
                  <button
                    aria-expanded={expanded}
                    className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-left text-sm font-bold text-foreground hover:bg-muted"
                    onClick={(event) => { event.preventDefault(); setOpenGroups((current) => ({ ...current, [group.label]: !expanded })); }}
                    type="button"
                  >
                    {group.label}
                    <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
                  </button>
                  {expanded ? (
                    <div className="grid gap-0.5 pb-1 pl-2">
                      {group.items.map((item) => <MenuLink item={item} workspace={workspace} location={location} websiteInquiryCount={websiteInquiryCount} pendingEmailReviewCount={pendingEmailReviewCount} key={`${group.label}:${item.href}:${item.label}`} />)}
                    </div>
                  ) : null}
                </div>
              );
            })
          : workspaceGroups.map((group) => (
              <div key={group.label} className="py-0.5">
                {workspace !== "booking" ? (
                  <MenuSubmenu
                    label={group.label}
                    groups={[group]}
                    workspace={workspace}
                    location={location}
                    websiteInquiryCount={websiteInquiryCount}
                    pendingEmailReviewCount={pendingEmailReviewCount}
                  />
                ) : null}
              </div>
            ))}
        {!mobile ? <DropdownMenuSeparator /> : null}
        {!mobile ? (
          <MenuSubmenu
            label="Administration"
            groups={visibleAdminToolsGroups}
            workspace={workspace}
            location={location}
            nestedGroups
            websiteInquiryCount={websiteInquiryCount}
            pendingEmailReviewCount={pendingEmailReviewCount}
          />
        ) : null}
        <DropdownMenuSeparator />
        <AppearanceChoices appearance={appearance} onChange={chooseAppearance} />
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">Account</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
