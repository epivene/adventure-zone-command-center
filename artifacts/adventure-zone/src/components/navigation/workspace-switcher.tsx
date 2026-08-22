import { ChevronDown, LayoutGrid, Megaphone, MapPinned, Settings2 } from "lucide-react";
import { Link, useLocation } from "wouter";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel className="text-xs uppercase tracking-wide text-slate-500">Workspaces</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href="/command"><LayoutGrid className="mr-2 h-4 w-4" />Command Panel</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/today">Booking</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link
            href="/marketing"
            onClick={() => {
              if (workspace === "booking") saveBookingReturnPath(location);
              else if (workspace === "command") clearBookingReturnPath();
            }}
          >
            <Megaphone className="mr-2 h-4 w-4" />Marketing
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/routes"><MapPinned className="mr-2 h-4 w-4" />Legs & Operations</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings"><Settings2 className="mr-2 h-4 w-4" />Admin Tools</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
