import { useState } from "react";
import { Link, useLocation } from "wouter";
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
import { archiveProfile } from "@/actions/profile-lifecycle";

export function ProfileActionsMenu({
  profileId,
  contactId,
}: {
  profileId: string;
  contactId?: string | null;
}) {
  const [, setLocation] = useLocation();
  const [archiving, setArchiving] = useState(false);
  const fullProfile = `/profiles/${profileId}`;
  const withContact = contactId ? `${fullProfile}?contactId=${encodeURIComponent(contactId)}` : fullProfile;

  async function archive() {
    if (archiving) return;
    const confirmed = window.confirm(
      "Archive this profile? Contacts, bookings, notes, history, and relationships will stay intact. You can restore it later from Archived records.",
    );
    if (!confirmed) return;
    setArchiving(true);
    try {
      await archiveProfile(profileId);
      setLocation("/archived");
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not archive this profile.");
    } finally {
      setArchiving(false);
    }
  }

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
            <DropdownMenuItem
              disabled={archiving}
              onSelect={(event) => {
                event.preventDefault();
                void archive();
              }}
            >
              {archiving ? "Archiving…" : "Archive profile"}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
