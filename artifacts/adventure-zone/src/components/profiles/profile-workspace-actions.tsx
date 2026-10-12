export function ProfileWorkspaceActions({
  onFollowUp,
  readOnly = false,
}: {
  onFollowUp(): void;
  readOnly?: boolean;
}) {
  return (
    readOnly ? null : (
      <button data-testid="profile-action-follow-up" type="button" className="button-primary" onClick={onFollowUp}>
        Follow up
      </button>
    )
  );
}
