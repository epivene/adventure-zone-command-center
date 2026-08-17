import { Link } from "wouter";
import { MoreHorizontal } from "lucide-react";
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
} from "@/components/ui/dropdown-menu";

export function ProfileActionsMenu({
  profileId,
  contactId,
}: {
  profileId: string;
  contactId?: string | null;
}) {
  const fullProfile = `/profiles/${profileId}`;
  const withContact = contactId ? `${fullProfile}?contactId=${encodeURIComponent(contactId)}` : fullProfile;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="button-secondary inline-flex items-center gap-2" type="button">
          <MoreHorizontal className="h-4 w-4" /> Actions
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Profile actions</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Add</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuItem asChild><Link href={`${withContact}${withContact.includes("?") ? "&" : "?"}action=follow-up`}>Note / Follow-up</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/event-profiles/new">Event</Link></DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Edit</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuItem asChild><Link href={`/event-profiles/${profileId}/edit`}>Profile</Link></DropdownMenuItem>
            {contactId ? <DropdownMenuItem asChild><Link href={`/contacts/${contactId}/edit`}>Contact info</Link></DropdownMenuItem> : null}
            <DropdownMenuItem asChild><Link href={fullProfile}>Status</Link></DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Organize</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-60">
            <DropdownMenuItem asChild><Link href={fullProfile}>Add to Organization</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={fullProfile}>Add to Event Family</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/profiles">Handle Duplicate / Merge</Link></DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <DropdownMenuItem asChild><Link href={fullProfile}>Open Full Profile</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={fullProfile}>Archive / Delete</Link></DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
