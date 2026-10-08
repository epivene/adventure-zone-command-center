# Correcting a wrong email/profile association

COM can inspect a filing conflict today, but the normal filing preview intentionally rejects an existing destination conflict. This change supplies a separate correction path rather than weakening normal filing.

1. Read the full current Gmail conversation, the conflict mappings, and the source/destination profile records. Compare event identity, location, correspondents and history. Similar names alone do not identify a destination.
2. Call `preview_email_mapping_repair` with the exact current Google account ID, Gmail thread ID, current message ID and verified destination profile ID.
3. Review all returned mappings, resolved reviews, prior profiles, saved reply state and blockers. Call `repair_email_profile_mapping` with the exact preview revision, an identity-based reason and a stable request key.
4. Verify the receipt and reread conflict mappings. For sent/received mail, run the existing email assignment preview/apply workflow with the current reply state, then read its Gmail and history sync receipt. For unsent drafts, use draft filing; Gmail drafts cannot have user profile labels.
5. Report any unfinished synchronization separately. A mapping repair receipt does not mean Gmail labels or history synchronization completed.

## Behavior

- Requires an active owner-bound connector and `email:organize` for writes; preview requires `crm:read`.
- Binds the correction to source message/account/thread, target profile revision, complete mapping/review snapshot, prior profile identity, attention revision and thread intent.
- Corrects existing mappings for the reviewed thread and resolved review destinations. Leaves pending review decisions alone.
- Preserves existing reply state, reason, due date and event year. A follow-up tied to a different profile blocks correction; it is never silently dropped or reassigned.
- Retains complete before/after mapping, contact-link, evidence, review, attention and intent data with the actor, connector and reason in audit history.
- Supersedes pending old assignment intents/jobs without making a Gmail API mutation.
- Never deletes/merges profiles, sends mail, moves old customer archives or certifies a draft ready.
- Cross-thread stored message mappings and snapshots larger than 500 rows are rejected for explicit investigation.
- Repeated identical request keys return the committed receipt. Changed inputs or stale snapshots are rejected. Mapping and audit persistence are transactional.

## Arapahoe incident

Read-only investigation found Gmail thread `19eb2741d1c95faf`, with a current sent proposal message `1a11c693493fd02f` and correspondence from Lexy Kingsbaker at `lkingsbaker@arapahoegov.com`.

- Reported wrong profile: `0ae5e530-65e7-453c-a2c3-d777a1e9a8ec` — Fair A, Springfield, IL. Its saved history page was empty.
- Existing historical profile: `4f1f7f2e-75d4-4e23-851e-f0507f8f5ddb` — County Fair - Arapahoe (Aurora) CO. Saved history includes prior Lexy correspondence and the same Aurora address/domain.
- Additional profile: `d14d9ef0-cb4e-4f6a-8bc0-f7e114e29a74` — Arapahoe County Fair. Contains directory and research notes.

These observations support investigation of the older Aurora profile as the filing destination. They do not authorize deleting or merging the additional profile. Recheck the full current source, full profile records and exact live mapping before applying. The app Google connection UUID has not been obtained in this session; do not invent it or substitute a Gmail OAuth account ID.

No live mapping has been changed by this code work.

## Validation status

Added PGlite regression cases for conflict-to-repair-to-filing, exact account/thread boundaries, evidence/profile preservation, stale snapshots, idempotency, revoked permissions, linked-follow-up blockers, old job superseding, resolved-review correction and audit-failure rollback.

The local execution service rejects process creation with `helper_unknown_error: setup refresh had errors`. Tests and typechecking have **not run**. Keep this change in draft until those checks can be executed. Do not initiate paid Actions for this task.
