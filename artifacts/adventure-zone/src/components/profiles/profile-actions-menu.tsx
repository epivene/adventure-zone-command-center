import { Link } from "wouter";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ProfileActionsMenu({
  profileId,
  contactId,
  onAddNote,
}: {
  profileId: string;
  contactId?: string | null;
  onAddNote?: () => void;
}) {
  const fullProfile = `/profiles/${profileId}`;
  const withContact = contactId ? `${fullProfile}?contactId=${encodeURIComponent(contactId)}` : fullProfile;
  const followUpHref = `${withContact}${withContact.includes("?") ? "&" : "?"}action=follow-up`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="button-secondary inline-flex items-center gap-2" type="button">
          <MoreHorizontal className="h-4 w-4" /> Actions
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>Profile actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAddNote?.()}>Add note</DropdownMenuItem>
        <DropdownMenuItem asChild><Link href={followUpHref}>Add follow-up</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link href="/event-profiles/new">Add event</Link></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
