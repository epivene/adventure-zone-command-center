# Google Email Review and Profile Files Design

**Status:** User-approved continuation of Google Workspace rollout
**Date:** 2026-08-24

## Goal

Finish the bounded 100-message validation workflow so unresolved business email can be assigned to the correct profile, and copy attachments from approved sample conversations into durable private Command Center storage where they can be opened from that profile.

## Product decisions

- This remains a bounded validation/sample feature. It does not start full historical backfill.
- Personal/ignored mail remains excluded and is never made profile-visible.
- Needs Review items remain unlinked until the owner explicitly assigns them to a profile or ignores them.
- Manual assignment is authoritative for the sample and auditable.
- A review item may suggest one or more candidate profiles, but the owner may select a different profile through profile search.
- Approving resolved matches never auto-resolves outstanding review items.
- Gmail remains read-only.
- Approved sample attachments are copied into existing private Google Cloud object storage.
- File bytes are keyed by SHA-256 so identical attachment bytes are not stored twice.
- The original Gmail thread/message identity and attachment identity remain attached to the file record.
- Profile Files lists only files belonging to that profile.
- Opening a stored file uses a short-lived signed read URL. Storage credentials are never sent to the browser.
- Attachment copy failure does not remove the approved conversation; it creates a visible retry/unavailable file state.
- No AI is required.
- Leg managers receive no email/review/file access.

## Review workflow

Each unresolved validation item has one of:

- `pending`: owner action required;
- `resolved`: assigned to an organization/profile;
- `ignored`: explicitly excluded from CRM.

The review row retains only the bounded metadata already used by validation: Google message/thread IDs, subject, participants, labels, evidence codes, candidate organization IDs/names, and attachment-presence flag. Full bodies are fetched only when an approved/mapped thread is opened.

Owner actions:

1. choose a suggested profile;
2. search for another profile and assign it;
3. ignore the item as not useful/business relevant.

Assigning a review item creates/updates the same durable validation mapping used by automatic matches so downstream profile presentation has one source of truth.

## Durable sample files

When an approved profile conversation is inspected or after resolved sample approval, attachment copy is idempotent.

For each Gmail attachment:

1. verify the thread is approved for the requested profile;
2. fetch attachment bytes using Gmail read-only access;
3. compute SHA-256;
4. reuse an existing storage object/file record for identical bytes when possible;
5. otherwise upload to private storage under a Google Workspace namespace;
6. persist source linkage and availability;
7. expose it in the profile Files list.

Stored file metadata includes filename, MIME type, byte size, SHA-256, storage key, Google thread/message/attachment IDs, organization ID, and timestamps.

## Profile presentation

The existing Google section on a full profile gains two explicit views:

- **Emails** — approved Gmail conversations; opens complete read-only thread.
- **Files** — copied Gmail attachments associated with that profile.

Files show filename, type, size, source conversation, copied date, and an **Open file** action that requests a 15-minute signed URL.

## Rollout safety

- Full historical processing stays disabled.
- Only messages from the bounded validation sample can create review mappings or sample file copies in this phase.
- Review assignment and ignore decisions are audited.
- File copy is idempotent and safe to retry.
- Cross-profile access returns 404 rather than revealing another profile's source identity.
- No Google mutation scopes or API calls are introduced.