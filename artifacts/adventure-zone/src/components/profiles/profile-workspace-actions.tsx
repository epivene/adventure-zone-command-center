export function ProfileWorkspaceActions({
  onFollowUp,
  onOpenEmails,
  onAddNote,
  onAssistant,
}: {
  onFollowUp(): void;
  onOpenEmails(): void;
  onAddNote(): void;
  onAssistant(): void;
}) {
  return (
    <div aria-label="Profile actions" className="flex flex-wrap gap-2">
      <button type="button" className="button-primary" onClick={onFollowUp}>
        Follow up
      </button>
      <button type="button" className="button-secondary" onClick={onOpenEmails}>
        Open emails
      </button>
      <button type="button" className="button-secondary" onClick={onAddNote}>
        Add note
      </button>
      <button type="button" className="button-secondary" onClick={onAssistant}>
        Assistant
      </button>
    </div>
  );
}
