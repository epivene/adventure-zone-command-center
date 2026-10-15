# Connector contact creation and work assignment recovery

`create_profile_contact` adds a sourced person to an existing profile under the existing `crm:append` scope. It requires the profile revision returned by `search_profiles`, a source URL, and identity/role evidence. Read the complete source and current profile contacts before saving. Unknown email or job title is null; an unknown surname is an empty string. Phone entry and editing existing contacts remain app operations.

The operation creates the person, an active non-primary profile relationship, ACT sync state, source note, audit entry and retry-safe receipt in one transaction. Existing people, primary choices and predecessor relationships remain unchanged. An email match anywhere or same-name profile contact blocks creation for review, including inactive/imported records. It does not silently link, resurrect, merge or overwrite an existing person.

After deployment and refreshing connector tools, read back the new contact using `read_profile_context` with section `contacts` or the existing app-record reads. A historical operation receipt alone does not establish the current contact state.

`WORK_NOT_ASSIGNED` now includes the card ID, current revision, assigned actor, current connection ID, profile review link and recovery guidance. An unassigned card can be claimed with `claim_existing_booking_work`, then updated with the returned revision. A card assigned to another actor, including an older connection, requires owner reassignment through the existing app control. This change does not add takeover permissions or automatically release old assignments.

Validation: six PGlite cases cover atomic contact creation with the primary-organization relationship FK, idempotency, duplicate email/name checks, stale/consolidated profiles, missing/revoked authorization, audit-failure rollback, foreign work ownership and claim-then-update recovery. No migration is needed.
