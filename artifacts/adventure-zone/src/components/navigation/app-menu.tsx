import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, Menu, Plus } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth-context";

type MenuItem = { href: string; label: string };
type MenuGroup = { label: string; items: MenuItem[] };

const adminMenuGroups: MenuGroup[] = [
  {
    label: "Bookings & Follow-ups",
    items: [
      { href: "/bookings", label: "Bookings" },
      { href: "/calls/workspace", label: "Calls" },
      { href: "/office-coordinator", label: "Office Coordinator" },
      { href: "/research-sources", label: "Research Sources" },
      { href: "/quick-add", label: "Quick add" },
      { href: "/contacts", label: "All contacts" },
    ],
  },
  {
    label: "Legs & Operations",
    items: [
      { href: "/routes", label: "Leg management" },
      { href: "/manager-communications", label: "Communications" },
      { href: "/manager-finance", label: "Finances" },
      { href: "/manager-crew", label: "Crew" },
      { href: "/manager-aftermath", label: "Reviews & incidents" },
      { href: "/manager-issues", label: "Route issues" },
    ],
  },
  {
    label: "Imports & Data",
    items: [
      { href: "/settings/business-sources", label: "Business sources" },
      { href: "/imports/attendance-history", label: "Attendance history" },
      { href: "/settings/paper-notes", label: "Paper notes" },
      { href: "/settings/act-migration", label: "Act! import" },
      { href: "/settings/act-recovery", label: "ACT recovery" },
    ],
  },
  {
    label: "Settings",
    items: [
      { href: "/settings/communication-templates", label: "Email templates" },
      { href: "/settings/call-scripts", label: "Call scripts" },
      { href: "/settings/packages-resources", label: "Packages & resources" },
      { href: "/settings", label: "Settings" },
    ],
  },
];

export function AddMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Add" className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600" type="button">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem asChild><Link href="/event-profiles/new">New event</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/contacts/new">New contact</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/quick-add">Quick add</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppMenu({ mobile = false }: { mobile?: boolean }) {
  const { signOut } = useAuth();
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button aria-label="Menu" className={mobile ? "flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100" : "inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"} type="button">
          <Menu className="h-5 w-5" />
          <span>Menu</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side={mobile ? "top" : "bottom"} className={mobile ? "max-h-[72dvh] w-[min(92vw,24rem)] overflow-y-auto p-2" : "max-h-[76vh] w-80 overflow-y-auto p-2"}>
        {adminMenuGroups.map((group, index) => {
          const expanded = openGroups[group.label] ?? index === 0;
          return (
            <div key={group.label} className="py-1">
              <button aria-expanded={expanded} className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm font-bold text-slate-800 hover:bg-slate-50" onClick={(event) => { event.preventDefault(); setOpenGroups((current) => ({ ...current, [group.label]: !expanded })); }} type="button">
                {group.label}
                <ChevronDown className={`h-4 w-4 transition ${expanded ? "rotate-180" : ""}`} />
              </button>
              {expanded ? (
                <div className="grid gap-0.5 pb-1 pl-2">
                  {group.items.map((item) => (
                    <DropdownMenuItem asChild key={`${group.label}:${item.href}:${item.label}`}>
                      <Link href={item.href}>{item.label}</Link>
                    </DropdownMenuItem>
                  ))}
                </div>
              ) : null}
              {index < adminMenuGroups.length - 1 ? <DropdownMenuSeparator /> : null}
            </div>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-slate-500">Account</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => signOut()}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
