export function ProfileWorkspaceActions({
  onFollowUp,
  onOpenEmails,
  onAddNote,
  onAssistant,
  readOnly = false,
  emailCount,
}: {
  onFollowUp(): void;
  onOpenEmails(): void;
  onAddNote(): void;
  onAssistant(): void;
  readOnly?: boolean;
  emailCount?: number;
}) {
  return (
    <div aria-label="Profile actions" className="flex flex-wrap gap-2">
      {!readOnly ? <button type="button" className="button-primary" onClick={onFollowUp}>
        Follow up
      </button> : null}
      <button type="button" className="button-secondary" onClick={onOpenEmails} aria-label={emailCount === undefined ? undefined : `${emailCount} Emails`}>
        Open emails
      </button>
      {!readOnly ? <button type="button" className="button-secondary" onClick={onAddNote}>
        Add note
      </button> : null}
      {!readOnly ? <button type="button" className="button-secondary" onClick={onAssistant}>
        Assistant
      </button> : null}
    </div>
  );
}
