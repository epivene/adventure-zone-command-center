import { Check, ChevronDown, House, LayoutGrid, MapPinned, Settings2 } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@workspace/avz-crm/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";
import type { AdminWorkspace } from "@/lib/admin-workspace";

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
  { workspace: "operations" as const, href: "/operations/legs", label: "Legs & Operations", icon: MapPinned },
];

export function WorkspaceSwitcher({ workspace }: { workspace: AdminWorkspace }) {

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Current workspace: ${workspaceLabel[workspace]}`}
          className="mr-2 inline-flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          type="button"
        >
          <img alt="" aria-hidden="true" className="h-5 w-5 shrink-0" src="/favicon.svg" />
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
              className={cn(
                "mb-0.5 rounded-lg px-2.5 py-2.5 text-sm",
                active && "bg-secondary font-semibold text-secondary-foreground",
              )}
              key={item.workspace}
            >
              <Link
                href={item.href}
              >
                <Icon className="mr-2 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {active ? <Check aria-label="Current workspace" className="ml-2 h-4 w-4 shrink-0 text-primary" /> : null}
              </Link>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator className="my-1.5" />
        <DropdownMenuItem
          asChild
          className={cn(
            "rounded-lg px-2.5 py-2.5 text-sm",
            workspace === "admin" ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground",
          )}
        >
          <Link href="/settings">
            <Settings2 className="mr-2 h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">Admin Tools</span>
            {workspace === "admin" ? <Check aria-label="Current workspace" className="ml-2 h-4 w-4 shrink-0 text-primary" /> : null}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
