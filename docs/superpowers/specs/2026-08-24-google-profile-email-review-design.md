# Google Profile Email Review Design

**Status:** Approved in chat
**Date:** 2026-08-24

## Goal

Turn the recent Gmail relevance check into a usable CRM workflow: resolve contact matches to the correct organization/profile when deterministic CRM relationships allow it, let the owner approve the bounded sample, and expose approved sample conversations from the related profile without starting the full historical backfill.

## Product behavior

- Exact contact-email evidence may resolve to a profile only through the contact's current active organization relationship.
- A contact tied to exactly one active live organization may produce a deterministic profile match.
- A contact tied to multiple active organizations never auto-selects one; it remains Needs Review.
- Direct unique organization-domain and exact profile-name evidence continue to work.
- The recent-validation UI must display the matched profile/organization, not only the contact candidate.
- The sample must end in an explicit owner decision: Approve sample or Reject/keep reviewing.
- Approval does not start historical backfill. It only records that the bounded sample is acceptable and makes approved sample conversations available on profiles.
- Rejection does not delete Gmail or alter Google; the owner may rerun after rules change.
- Full historical import and AI remain disabled.

## Profile presentation

Add a Google Email area to owner event/organization profiles for the approved validation sample.

The first release shows:
- subject;
- participants;
- date;
- match evidence;
- the matched contact when applicable;
- the resolved profile;
- original Gmail link;
- a thread-detail action.

Thread detail is read live from Gmail in read-only mode and shows the complete readable thread and attachment metadata. This PR does not permanently archive email bodies or attachment bytes; durable body/file archive remains the later backfill phase.

Attachments are listed with filename, MIME type, size, and source message. Actual durable file copying/download management remains in the historical archive phase.

## Persistence

Persist only approval/mapping state required for the validation sample, not Gmail body content:

- Google message/thread source identity;
- resolved organization/profile ID;
- optional matched contact ID;
- deterministic evidence codes;
- approval state;
- reviewed/approved timestamp and actor.

The same Google message/thread must be idempotent on rerun.

## Validation approval states

- `not_started`
- `ready_for_review`
- `approved`
- `rejected`

The validation endpoint may populate/reconcile candidate mapping rows, but body content is not stored.

## Gmail thread detail

The read client gains read-only thread detail methods. Thread detail may fetch full Gmail message payloads only after the owner opens a matched/approved conversation. No AI receives this content in this PR.

## Security

- Owner routes remain behind owner middleware.
- No manager route is added.
- Gmail is read-only; no send, archive, label, trash, draft, or calendar mutation methods are added.
- Personal/ignored messages are not exposed from profile APIs.
- A profile may only retrieve conversations explicitly mapped to that organization.

## Rollout

This PR remains stacked on `fix/google-workspace-business-relevance-only` until PR #453 is merged. It must not enable `GOOGLE_WORKSPACE_SYNC_ENABLED` or `GOOGLE_WORKSPACE_AI_ENABLED`.