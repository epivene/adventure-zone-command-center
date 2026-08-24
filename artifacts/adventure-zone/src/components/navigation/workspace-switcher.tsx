import { Check, ChevronDown, House, LayoutGrid, Megaphone, MapPinned, Settings2 } from "lucide-react";
import { Link, useLocation } from "wouter";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  clearBookingReturnPath,
  saveBookingReturnPath,
  type AdminWorkspace,
} from "@/lib/admin-workspace";

const workspaceLabel: Record<AdminWorkspace, string> = {
  command: "Command Panel",
  booking: "Booking",
  marketing: "Marketing",
  operations: "Legs & Operations",
  admin: "Admin Tools",
};

const workspaceItems = [
  { workspace: "command" as const, href: "/command", label: "Command Panel", icon: LayoutGrid },
  { workspace: "booking" as const, href: "/today", label: "Booking", icon: House },
  { workspace: "marketing" as const, href: "/marketing", label: "Marketing", icon: Megaphone },
  { workspace: "operations" as const, href: "/operations/legs", label: "Legs & Operations", icon: MapPinned },
];

export function WorkspaceSwitcher({ workspace }: { workspace: AdminWorkspace }) {
  const [location] = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Current workspace: ${workspaceLabel[workspace]}`}
          className="mr-2 inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
          type="button"
        >
          <img alt="" aria-hidden="true" className="h-5 w-5 shrink-0" src="/favicon.svg" />
          <span className="truncate font-bold tracking-tight">Adventure Zone</span>
          <span aria-hidden="true" className="text-slate-300 dark:text-slate-600">·</span>
          <span className="truncate text-sm font-semibold text-slate-500 dark:text-slate-400">{workspaceLabel[workspace]}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-xl border-slate-200 p-1.5 shadow-xl dark:border-slate-700">
        {workspaceItems.map((item) => {
          const Icon = item.icon;
          const active = workspace === item.workspace;
          return (
            <DropdownMenuItem
              asChild
              className={`mb-0.5 rounded-lg px-2.5 py-2.5 text-sm ${active ? "bg-orange-50 font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300" : ""}`}
              key={item.workspace}
            >
              <Link
                href={item.href}
                onClick={() => {
                  if (item.workspace !== "marketing") return;
                  if (workspace === "booking") saveBookingReturnPath(location);
                  else if (workspace === "command") clearBookingReturnPath();
                }}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active ? <Check aria-label="Current workspace" className="ml-2 h-4 w-4 shrink-0" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          asChild
          className={`rounded-lg px-2.5 py-2.5 text-sm ${workspace === "admin" ? "bg-orange-50 font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300" : "text-slate-600 dark:text-slate-300"}`}
        >
          <Link href="/settings">
            <Settings2 className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Admin Tools</span>
            {workspace === "admin" ? <Check aria-label="Current workspace" className="ml-2 h-4 w-4 shrink-0" /> : null}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
