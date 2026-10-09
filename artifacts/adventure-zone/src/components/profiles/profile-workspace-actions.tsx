import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";

export function ProfileWorkspaceActions({
  onFollowUp,
  onOpenEmails,
  onAssistant,
  readOnly = false,
  emailCount,
}: {
  onFollowUp(): void;
  onOpenEmails(): void;
  onAssistant(): void;
  readOnly?: boolean;
  emailCount?: number;
}) {
  return (
    <div aria-label="Profile actions" className="flex flex-wrap gap-2" data-testid="profile-actions">
      {!readOnly ? (
        <button data-testid="profile-action-follow-up" type="button" className="button-primary" onClick={onFollowUp}>
          Follow up
        </button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="button-secondary inline-flex items-center gap-2"
            aria-label="More actions"
            data-testid="profile-action-more"
          >
            More actions
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            aria-label={emailCount === undefined ? "Open emails" : `${emailCount} Emails`}
            data-testid="profile-action-emails"
            onSelect={onOpenEmails}
          >
            Open emails
          </DropdownMenuItem>
          {!readOnly ? (
            <DropdownMenuItem data-testid="profile-action-assistant" onSelect={onAssistant}>
              Assistant
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
