import { forwardRef, useState, type AnchorHTMLAttributes } from "react";
import {
  Bot,
  CalendarDays,
  Check,
  ChevronDown,
  ContactRound,
  Ellipsis,
  FolderOpen,
  House,
  Inbox,
  LayoutGrid,
  MapPinned,
  Megaphone,
  Moon,
  Palette,
  Plus,
  Settings2,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
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

type AdminWorkspace = "command" | "booking" | "marketing" | "operations" | "admin";
type NavigationItem = { href: string; label: string; icon: LucideIcon };
type MenuItem = { href: string; label: string };
type MenuGroup = { label: string; items: MenuItem[] };

// Kept in sync with the production booking-navigation.ts source.
function bookingNavigation(mobile = false) {
  return [
    { href: "/today", label: "Today", icon: "home" },
    { href: "/profiles", label: "Profiles", icon: "profiles" },
    { href: "/emails", label: "Emails", icon: "emails" },
    ...(!mobile ? [{ href: "/business-documents", label: "Documents", icon: "documents" as const }] : []),
    { href: "/schedule", label: mobile ? "Schedule" : "Schedule & Routes", icon: "schedule" },
  ] as const;
}

const bookingItems: MenuItem[] = [
  { href: "/profiles", label: "Profiles" },
  { href: "/dave-requests", label: "Dave Requests" },
  { href: "/emails", label: "Emails" },
  { href: "/emails?view=review", label: "Emails needing review" },
  { href: "/calls/workspace", label: "Calls" },
  { href: "/calls/voicemail", label: "Voicemail" },
  { href: "/website-inquiries", label: "Website Inquiries" },
  { href: "/boss-access", label: "Boss Access" },
  { href: "/research-sources", label: "Research Sources" },
  { href: "/needs-answer", label: "Needs Answer" },
];

const bookingToolsGroups: MenuGroup[] = [{ label: "Booking tools", items: bookingItems }];
const adminToolsGroups: MenuGroup[] = [
  { label: "Review queues", items: [{ href: "/emails", label: "Emails" }, { href: "/emails?view=review", label: "Emails needing review" }] },
  { label: "Data & Imports", items: [{ href: "/settings/paper-notes", label: "Paper notes" }, { href: "/settings/act-migration", label: "ACT! import" }, { href: "/settings/act-recovery", label: "ACT Recovery" }, { href: "/imports/attendance-history", label: "Attendance history" }] },
  { label: "Business Setup", items: [{ href: "/settings/business-sources", label: "Business sources" }, { href: "/settings/coi", label: "Certificates of insurance" }, { href: "/settings/packages-resources", label: "Packages & resources" }, { href: "/settings/call-scripts", label: "Call scripts" }, { href: "/settings/communication-templates", label: "Email templates" }] },
  { label: "Connections", items: [{ href: "/settings/google-workspace", label: "Google Workspace" }] },
  { label: "System", items: [{ href: "/settings", label: "Settings" }] },
];

const appearanceOptions = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const workspaceItems = [
  { workspace: "command" as const, href: "/command", label: "Command Panel", icon: LayoutGrid },
  { workspace: "booking" as const, href: "/today", label: "Booking", icon: House },
  { workspace: "marketing" as const, href: "/marketing", label: "Marketing", icon: Megaphone },
  { workspace: "operations" as const, href: "/operations/legs", label: "Legs & Operations", icon: MapPinned },
];

const workspaceLabel: Record<AdminWorkspace, string> = {
  command: "Command Panel",
  booking: "Booking",
  marketing: "Marketing",
  operations: "Legs & Operations",
  admin: "Admin Tools",
};

const AppLink = forwardRef<
  HTMLAnchorElement,
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "onClick"> & {
    href: string;
    onNavigate: (href: string) => void;
  }
>(function AppLink({ href, onNavigate, children, ...props }, ref) {
  return (
    <a
      {...props}
      ref={ref}
      href={href}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(href);
      }}
    >
      {children}
    </a>
  );
});

function WorkspaceSwitcher({
  workspace,
  onNavigate,
  onWorkspaceChange,
}: {
  workspace: AdminWorkspace;
  onNavigate: (href: string) => void;
  onWorkspaceChange: (workspace: AdminWorkspace) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Current workspace: ${workspaceLabel[workspace]}`}
          className="mr-2 inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          type="button"
        >
          <img alt="" aria-hidden="true" className="h-5 w-5 shrink-0" src="/__mockup/images/adventure-zone-logo.png" />
          <span className="truncate font-bold tracking-tight text-foreground">Adventure Zone</span>
          <span aria-hidden="true" className="text-border">·</span>
          <span className="truncate text-sm font-semibold text-muted-foreground">{workspaceLabel[workspace]}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-xl border-border p-1.5 shadow-xl">
        {workspaceItems.map((item) => {
          const Icon = item.icon;
          const active = workspace === item.workspace;
          return (
            <DropdownMenuItem
              asChild
              className={cn("mb-0.5 rounded-lg px-2.5 py-2.5 text-sm", active && "bg-secondary font-semibold text-secondary-foreground")}
              key={item.workspace}
            >
              <AppLink
                href={item.href}
                onNavigate={(href) => {
                  onWorkspaceChange(item.workspace);
                  onNavigate(href);
                }}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active ? <Check aria-label="Current workspace" className="ml-2 h-4 w-4 shrink-0 text-primary" /> : null}
              </AppLink>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          asChild
          className={cn("rounded-lg px-2.5 py-2.5 text-sm", workspace === "admin" ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground")}
        >
          <AppLink href="/settings" onNavigate={(href) => { onWorkspaceChange("admin"); onNavigate(href); }}>
            <Settings2 className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Admin Tools</span>
            {workspace === "admin" ? <Check aria-label="Current workspace" className="ml-2 h-4 w-4 shrink-0 text-primary" /> : null}
          </AppLink>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MenuLink({
  item,
  workspace,
  location,
  onNavigate,
}: {
  item: MenuItem;
  workspace: AdminWorkspace;
  location: string;
  onNavigate: (href: string) => void;
}) {
  const active = location === item.href || location.startsWith(`${item.href}/`);
  return (
    <DropdownMenuItem asChild className={cn(active && "bg-secondary font-semibold text-secondary-foreground")}>
      <AppLink href={item.href} onNavigate={onNavigate}>
        <span className="flex-1">{item.label}</span>
      </AppLink>
    </DropdownMenuItem>
  );
}

function MenuSubmenu({
  label,
  groups,
  workspace,
  location,
  onNavigate,
  nestedGroups = false,
}: {
  label: string;
  groups: MenuGroup[];
  workspace: AdminWorkspace;
  location: string;
  onNavigate: (href: string) => void;
  nestedGroups?: boolean;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className="rounded-md px-2 py-2 text-sm font-semibold">{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        {groups.map((group) => nestedGroups ? (
          <DropdownMenuSub key={group.label}>
            <DropdownMenuSubTrigger className="rounded-md px-2 py-2 text-sm font-semibold">{group.label}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-60">
              {group.items.map((item) => <MenuLink item={item} workspace={workspace} location={location} onNavigate={onNavigate} key={`${group.label}:${item.href}:${item.label}`} />)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : group.items.map((item) => <MenuLink item={item} workspace={workspace} location={location} onNavigate={onNavigate} key={`${group.label}:${item.href}:${item.label}`} />))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function AppMenu({
  workspace,
  mobile = false,
  location,
  onNavigate,
}: {
  workspace: AdminWorkspace;
  mobile?: boolean;
  location: string;
  onNavigate: (href: string) => void;
}) {
  const [appearance, setAppearance] = useState<"light" | "dark">("light");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const workspaceGroups = workspace === "booking" ? bookingToolsGroups : [];
  const groups = workspace === "command" ? [] : [...workspaceGroups, ...adminToolsGroups];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="More"
          className={cn(
            "inline-flex items-center gap-1 rounded-lg px-2.5 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted hover:text-foreground",
            mobile && "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs",
          )}
          type="button"
        >
          <Ellipsis className="h-5 w-5" />
          <span className={mobile ? "" : "hidden xl:inline"}>More</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={mobile ? "top" : "bottom"} className={mobile ? "max-h-[72dvh] w-[min(92vw,22rem)] overflow-y-auto p-2" : "max-h-[76vh] w-72 overflow-y-auto p-2"}>
        <DropdownMenuLabel>Documents</DropdownMenuLabel>
        <MenuLink item={{ href: "/business-documents", label: "All documents" }} workspace={workspace} location={location} onNavigate={onNavigate} />
        <MenuLink item={{ href: "/invoices-contracts", label: "Contracts & Invoices" }} workspace={workspace} location={location} onNavigate={onNavigate} />
        <DropdownMenuSeparator />
        {!mobile ? (
          <div className="grid gap-0.5 py-1">
            {workspace === "booking" ? <MenuSubmenu label="Booking tools" groups={bookingToolsGroups} workspace={workspace} location={location} onNavigate={onNavigate} /> : null}
            <DropdownMenuItem asChild className="rounded-md px-2 py-2">
              <AppLink href="/manager-communications" onNavigate={onNavigate}><span className="flex-1">Messages</span></AppLink>
            </DropdownMenuItem>
          </div>
        ) : null}
        <DropdownMenuItem asChild><AppLink href="/assistant/workspace" onNavigate={onNavigate} className="rounded-md px-2 py-2"><Bot className="h-4 w-4" />Assistant workspace</AppLink></DropdownMenuItem>
        <DropdownMenuItem className="rounded-md px-2 py-2"><Bot className="h-4 w-4" />Older conversations &amp; tools</DropdownMenuItem>
        {mobile && workspace === "booking" ? (
          <div className="grid gap-0.5 py-1">
            {bookingItems.map((item) => <MenuLink item={item} workspace={workspace} location={location} onNavigate={onNavigate} key={`${item.href}:${item.label}`} />)}
          </div>
        ) : null}
        {mobile ? groups.map((group) => {
          if (workspace === "booking" && group.label === "Booking tools") return null;
          const expanded = openGroups[group.label] ?? false;
          return (
            <div key={group.label} className="py-0.5">
              <button
                aria-expanded={expanded}
                className="flex w-full items-center justify-between rounded-md px-2 py-2.5 text-left text-sm font-bold text-foreground hover:bg-muted"
                onClick={(event) => { event.preventDefault(); setOpenGroups((current) => ({ ...current, [group.label]: !expanded })); }}
                type="button"
              >
                {group.label}<ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded ? <div className="grid gap-0.5 pb-1 pl-2">{group.items.map((item) => <MenuLink item={item} workspace={workspace} location={location} onNavigate={onNavigate} key={`${group.label}:${item.href}:${item.label}`} />)}</div> : null}
            </div>
          );
        }) : workspaceGroups.map((group) => <div key={group.label} className="py-0.5" />)}
        {!mobile ? <DropdownMenuSeparator /> : null}
        {!mobile ? <MenuSubmenu label="Administration" groups={adminToolsGroups} workspace={workspace} location={location} onNavigate={onNavigate} nestedGroups /> : null}
        <DropdownMenuSeparator />
        <div className="py-1">
          <div className="flex items-center gap-2 px-2 py-2 text-sm font-bold text-foreground"><Palette className="h-4 w-4" />Appearance</div>
          <div className="grid gap-0.5 pl-2">
            {appearanceOptions.map((option) => {
              const Icon = option.icon;
              return (
                <DropdownMenuItem key={option.value} onSelect={() => setAppearance(option.value)}>
                  <Icon className="mr-2 h-4 w-4" /><span className="flex-1">{option.label}</span>
                  {appearance === option.value ? <Check aria-label="Selected" className="h-4 w-4 text-primary" /> : null}
                </DropdownMenuItem>
              );
            })}
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-muted-foreground">Account</DropdownMenuLabel>
        <DropdownMenuItem>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AddMenu({ onNavigate }: { onNavigate: (href: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Add" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" type="button">
          <Plus className="h-4 w-4" /><span className="hidden xl:inline">Add</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem asChild><AppLink href="/event-profiles/new" onNavigate={onNavigate}>Add a New Profile</AppLink></DropdownMenuItem>
        <DropdownMenuItem asChild><AppLink href="/profiles" onNavigate={onNavigate}>Find a Profile</AppLink></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild><AppLink href="/calls/workspace?mode=add" onNavigate={onNavigate}>New caller</AppLink></DropdownMenuItem>
        <DropdownMenuItem asChild><AppLink href="/contacts/new" onNavigate={onNavigate}>Add a New Contact</AppLink></DropdownMenuItem>
        <DropdownMenuItem asChild><AppLink href="/contacts" onNavigate={onNavigate}>Find a Contact</AppLink></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function MobileBottomNav({ workspace, location, onNavigate }: { workspace: AdminWorkspace; location: string; onNavigate: (href: string) => void }) {
  const icons = { home: House, profiles: ContactRound, emails: Inbox, schedule: CalendarDays, documents: FolderOpen };
  const primaryItems = workspace === "booking"
    ? bookingNavigation(true).map((item) => ({ ...item, icon: icons[item.icon] }))
    : [{ href: "/command", label: "Panel", icon: LayoutGrid }];

  return (
    <nav aria-label="Mobile navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-4px_14px_rgba(15,23,42,0.08)] md:hidden">
      <div className="mx-auto grid max-w-lg gap-1" style={{ gridTemplateColumns: `repeat(${primaryItems.length + 1}, minmax(0, 1fr))` }}>
        {primaryItems.map((item) => {
          const active = location === item.href || (item.href.startsWith("/") && location.startsWith(`${item.href}/`));
          const Icon = item.icon;
          return (
            <AppLink
              aria-current={active ? "page" : undefined}
              className={cn("flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-1 text-xs font-semibold transition", active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              href={item.href}
              key={`${item.label}:${item.href}`}
              onNavigate={onNavigate}
            >
              <Icon className="h-5 w-5" />{item.label}
            </AppLink>
          );
        })}
        <AppMenu workspace={workspace} mobile location={location} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

function TodayWorkspace() {
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-muted-foreground">Tuesday, October 14, 2025</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Today</h1>
        </div>
        <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">Booking workspace</span>
      </div>
      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Follow-ups due", value: "8", note: "3 are overdue" },
          { label: "Events today", value: "2", note: "Next event at 11:30 AM" },
          { label: "Email reviews", value: "4", note: "Waiting for your review" },
        ].map((stat) => (
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm" key={stat.label}>
            <p className="text-sm font-semibold text-muted-foreground">{stat.label}</p>
            <div className="mt-2 flex items-baseline gap-2"><span className="text-2xl font-bold">{stat.value}</span><span className="text-sm text-muted-foreground">{stat.note}</span></div>
          </div>
        ))}
      </section>
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="text-xl font-bold">Today's work</h2><p className="mt-1 text-sm text-muted-foreground">Your next steps and time-sensitive booking work.</p></div>
          <button className="rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted" type="button">View all work</button>
        </div>
        <div className="mt-4 divide-y divide-border">
          {[
            { initials: "MC", name: "Maya Chen", task: "Send updated festival proposal", detail: "Riverfront Arts Festival · Due today", color: "bg-rose-100 text-rose-800" },
            { initials: "JR", name: "Jordan Reyes", task: "Confirm performance schedule", detail: "Autumn Harvest Celebration · Overdue", color: "bg-amber-100 text-amber-900" },
            { initials: "SP", name: "Sam Patel", task: "Review organizer email", detail: "Northside Community Fair · Due today", color: "bg-sky-100 text-sky-800" },
          ].map((item) => (
            <div className="flex items-center gap-3 py-4" key={item.name}>
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.color}`}>{item.initials}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{item.task}</p>
                <p className="mt-0.5 truncate text-sm text-muted-foreground">{item.name} <span aria-hidden="true">·</span> {item.detail}</p>
              </div>
              <button className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-primary hover:bg-muted sm:inline-flex" type="button">Open</button>
            </div>
          ))}
        </div>
      </section>
      <section className="mt-5 rounded-xl border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-bold">Today’s schedule</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg bg-muted p-3"><p className="text-sm font-bold">11:30 AM <span className="ml-2 font-normal text-muted-foreground">Organizer call</span></p><p className="mt-1 text-sm text-muted-foreground">Maya Chen · Riverfront Arts Festival</p></div>
          <div className="rounded-lg bg-muted p-3"><p className="text-sm font-bold">2:00 PM <span className="ml-2 font-normal text-muted-foreground">Proposal follow-up</span></p><p className="mt-1 text-sm text-muted-foreground">Jordan Reyes · Autumn Harvest Celebration</p></div>
        </div>
      </section>
    </div>
  );
}

export function CurrentCrmShell() {
  const [location, setLocation] = useState("/today");
  const [workspace, setWorkspace] = useState<AdminWorkspace>("booking");
  const primaryItems: NavigationItem[] = bookingNavigation().map((item) => {
    const icons = { home: House, profiles: UsersRound, emails: Inbox, schedule: CalendarDays, documents: FolderOpen };
    return { ...item, icon: icons[item.icon] };
  });

  return (
    <div className="min-h-[100dvh] bg-background text-foreground print:min-h-0">
      <header data-assistant-shell-header className="sticky top-0 z-20 hidden border-b border-border bg-card/95 backdrop-blur md:block print:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-2 px-4 py-2.5 lg:px-6">
          <WorkspaceSwitcher workspace={workspace} onNavigate={setLocation} onWorkspaceChange={setWorkspace} />
          {primaryItems.length ? (
            <nav aria-label="Main navigation" className="flex min-w-0 items-center gap-1">
              {primaryItems.map((item) => {
                const active = location === item.href || (item.href.startsWith("/") && location.startsWith(`${item.href}/`));
                const Icon = item.icon;
                return (
                  <AppLink
                    aria-current={active ? "page" : undefined}
                    className={cn("relative inline-flex items-center gap-2 rounded-lg px-2.5 py-2 text-sm font-semibold transition lg:px-3", active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
                    href={item.href}
                    key={`${item.label}:${item.href}`}
                    onNavigate={setLocation}
                  >
                    <Icon className="h-4 w-4" /><span className="hidden lg:inline">{item.label}</span>
                  </AppLink>
                );
              })}
            </nav>
          ) : null}
          <div className="ml-auto flex items-center gap-1.5">
            {workspace === "booking" ? <AddMenu onNavigate={setLocation} /> : null}
            <AppMenu workspace={workspace} location={location} onNavigate={setLocation} />
          </div>
        </div>
      </header>
      <main className={cn("min-h-screen px-3 py-4 pb-24 md:px-8 md:py-7 md:pb-8 print:min-h-0 print:p-0", location === "/assistant/workspace" && "md:px-4 md:py-4")}>
        <TodayWorkspace />
      </main>
      <div className="print:hidden"><MobileBottomNav workspace={workspace} location={location} onNavigate={setLocation} /></div>
    </div>
  );
}
