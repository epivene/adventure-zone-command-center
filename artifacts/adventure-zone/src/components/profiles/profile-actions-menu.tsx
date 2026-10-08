import { useState } from "react";
import { Link } from "wouter";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { ManualEventFamilyDialog } from "@/components/event-families/manual-event-family-dialog";
import {
  ProfileFillerBadge,
  ProfileFillerDialog,
  useProfileFillerState,
} from "@/components/profiles/profile-filler-action";
import {
  ProfileLastResortDialog,
  useProfileLastResortState,
} from "@/components/profiles/profile-last-resort-action";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";

export function ProfileActionsMenu({
  profileId,
  contactId,
  onAddNote,
  showAddNote = true,
  showFollowUp = true,
  onEdit,
  triggerLabel = "Actions",
  onOpenEmails,
  onAssistant,
  callHref,
}: {
  profileId: string;
  contactId?: string | null;
  onAddNote?: () => void;
  showAddNote?: boolean;
  showFollowUp?: boolean;
  onEdit?: () => void;
  triggerLabel?: string;
  onOpenEmails?: () => void;
  onAssistant?: () => void;
  callHref?: string | null;
}) {
  const [lastResortOpen, setLastResortOpen] = useState(false);
  const [fillerOpen, setFillerOpen] = useState(false);
  const [eventFamilyOpen, setEventFamilyOpen] = useState(false);
  const { state: lastResortState, refresh: refreshLastResort } = useProfileLastResortState(profileId);
  const { state: fillerState, refresh: refreshFiller } = useProfileFillerState(profileId);
  const fullProfile = `/profiles/${profileId}`;
  const withContact = contactId ? `${fullProfile}?contactId=${encodeURIComponent(contactId)}` : fullProfile;
  const followUpHref = `${withContact}${withContact.includes("?") ? "&" : "?"}action=follow-up`;
  const researchHref = `${withContact}${withContact.includes("?") ? "&" : "?"}research=1`;
  const lastResortLabel = lastResortState?.lastResort ? "Remove Last Resort" : "Mark Last Resort";
  const fillerLabel = fillerState?.filler ? "Remove Filler" : "Mark Filler";

  return (
    <>
      <div className="inline-flex items-center gap-2">
        <ProfileFillerBadge profileId={profileId} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {triggerLabel === "More" ? (
              <button className="button-secondary inline-flex items-center gap-2" type="button">
                More <ChevronDown className="h-4 w-4" />
              </button>
            ) : (
              <button className="button-secondary inline-flex items-center gap-2" type="button">
                <MoreHorizontal className="h-4 w-4" /> {triggerLabel}
              </button>
            )}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuLabel>Profile actions</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {showAddNote ? <DropdownMenuItem onSelect={() => onAddNote?.()}>Add note</DropdownMenuItem> : null}
            {onEdit ? <DropdownMenuItem onSelect={onEdit}>Edit profile</DropdownMenuItem> : null}
            {callHref ? <DropdownMenuItem asChild><Link href={callHref}>Open call workspace</Link></DropdownMenuItem> : null}
            {onOpenEmails ? <DropdownMenuItem onSelect={onOpenEmails}>Emails</DropdownMenuItem> : null}
            {onAssistant ? <DropdownMenuItem onSelect={onAssistant}>Assistant</DropdownMenuItem> : null}
            {showFollowUp ? <DropdownMenuItem asChild><Link href={followUpHref}>Add follow-up</Link></DropdownMenuItem> : null}
            <DropdownMenuItem onSelect={() => setEventFamilyOpen(true)}>Add to Event Family</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setFillerOpen(true)}>{fillerLabel}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setLastResortOpen(true)}>{lastResortLabel}</DropdownMenuItem>
            <DropdownMenuItem asChild><Link href={researchHref}>Research profile</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link href="/event-profiles/new">Add event</Link></DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ManualEventFamilyDialog onOpenChange={setEventFamilyOpen} open={eventFamilyOpen} seedProfileId={profileId} />
      <ProfileFillerDialog onChanged={async () => { await refreshFiller(); }} onOpenChange={setFillerOpen} open={fillerOpen} profileId={profileId} />
      <ProfileLastResortDialog onChanged={async () => { await refreshLastResort(); }} onOpenChange={setLastResortOpen} open={lastResortOpen} profileId={profileId} />
    </>
  );
}
