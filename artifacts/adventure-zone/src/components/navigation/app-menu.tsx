import { useState } from "react";
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

type MenuItem = { href: string; label: string; rememberBookingBeforeOpen?: boolean };
type MenuGroup = { label: string; items: MenuItem[] };

const bookingItems: MenuItem[] = [
  { href: "/bookings", label: "Bookings" },
  { href: "/profiles", label: "Profiles" },
  { href: "/calls/workspace", label: "Calls" },
  { href: "/office-coordinator", label: "Office Coordinator" },
  { href: "/research-sources", label: "Research Sources" },
  { href: "/needs-answer", label: "Needs Answer" },
];

const bookingToolItems: MenuItem[] = [
  { href: "/profiles", label: "Profiles" },
  { href: "/calls/workspace", label: "Calls" },
  { href: "/research-sources", label: "Research Sources" },
  { href: "/office-coordinator", label: "Office Coordinator" },
  { href: "/needs-answer", label: "Needs Answer" },
];

const bookingToolsGroups: MenuGroup[] = [
  { label: "Booking tools", items: bookingToolItems },
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
      { href: "/profiles", label: "Profiles & audiences" },
      { href: "/office-coordinator", label: "Office Coordinator" },
      { href: "/research-sources", label: "Opportunity research" },
    ],
  },
];

const adminToolsGroups: MenuGroup[] = [
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

function MenuLink({ item, workspace, location }: { item: MenuItem; workspace: AdminWorkspace; location: string }) {
  const active = location === item.href || location.startsWith(`${item.href}/`);
  return (
    <DropdownMenuItem asChild className={cn(active && "bg-secondary font-semibold text-secondary-foreground")}>
      <Link
        href={item.href}
        onClick={() => {
          if (item.rememberBookingBeforeOpen && workspace === "booking") saveBookingReturnPath(location);
        }}
      >
        {item.label}
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
}: {
  label: string;
  groups: MenuGroup[];
  workspace: AdminWorkspace;
  location: string;
  nestedGroups?: boolean;
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
}: {
  workspace: AdminWorkspace;
  mobile?: boolean;
  unreadMessages?: number;
}) {
  const { signOut } = useAuth();
  const { openAssistant } = useAssistantContext();
  const [location] = useLocation();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [appearance, setAppearance] = useState<Appearance>(() => readAppearance());
  const workspaceGroups = groupsForWorkspace(workspace);
  const groups = workspace === "command" ? [] : [...workspaceGroups, ...adminToolsGroups];
  const bookingMenuItems = bookingItems;

  function chooseAppearance(value: Appearance) {
    saveAppearance(value);
    setAppearance(value);
  }

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
      <DropdownMenuContent
        align="end"
        side={mobile ? "top" : "bottom"}
        className={mobile ? "max-h-[72dvh] w-[min(92vw,22rem)] overflow-y-auto p-2" : "max-h-[76vh] w-72 overflow-y-auto p-2"}
      >
        {!mobile ? (
          <div className="grid gap-0.5 py-1">
            {workspace === "booking" ? (
              <MenuSubmenu
                label="Booking tools"
                groups={bookingToolsGroups}
                workspace={workspace}
                location={location}
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
            <DropdownMenuItem
              aria-label="Open Booking Assistant"
              className="rounded-md px-2 py-2"
              onSelect={() => openAssistant()}
            >
              <Bot className="h-4 w-4" />
              Booking Assistant
            </DropdownMenuItem>
          </div>
        ) : null}
        {mobile && workspace === "booking" ? (
          <div className="grid gap-0.5 py-1">
            {bookingMenuItems.map((item) => <MenuLink item={item} workspace={workspace} location={location} key={`${item.href}:${item.label}`} />)}
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
                      {group.items.map((item) => <MenuLink item={item} workspace={workspace} location={location} key={`${group.label}:${item.href}:${item.label}`} />)}
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
                  />
                ) : null}
              </div>
            ))}
        {!mobile ? <DropdownMenuSeparator /> : null}
        {!mobile ? (
          <MenuSubmenu
            label="Admin Tools"
            groups={adminToolsGroups}
            workspace={workspace}
            location={location}
            nestedGroups
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
