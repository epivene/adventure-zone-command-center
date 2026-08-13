# Main Integration Report

Date: 2026-08-13
Branch: `codex/organization-location-hierarchy`

## Integrated histories

The feature history at `cbfb4af5d406f71a8db9b0ddcd08e339c8fb8ccf` and current main at `834cf25daec3eaa178679daa078f0e7c5383c935` were preserved as the two parents of merge commit `bc6d45265fff57cd33340c7b9ebbd2cf6035fbff`.

The merge used the complete current-main tree and overlaid every feature-side changed path. The three files changed on both histories were resolved as follows:

- `artifacts/adventure-zone/src/components/event-profiles/event-profile-workspace.tsx`: retained main's assisted-calling controls and phone suppression while adding parent/location hierarchy controls, location rollups, and safe website links.
- `lib/db/src/schema/index.ts`: retained main's contact-phone, call-session metadata, and disposition additions while adding the organization self-reference and family-review table.
- `pnpm-lock.yaml`: retained main's PGlite and Anthropic integration graph while keeping the feature's root Vitest dependency.

The hierarchy migration was moved from `020_organization_location_hierarchy.sql` to `024_organization_location_hierarchy.sql` so it follows main's assisted-calling/contact-phone migrations through 023.

## Integration fixes

Post-merge CI found and verified two integration-specific issues:

1. A malformed JSX closing tag introduced during manual overlap resolution.
2. Legacy event-profile callers and tests that do not yet provide the new `locations` array.

The JSX was corrected, and hierarchy rendering now treats an absent legacy `locations` value as an empty collection without changing the hierarchy-aware repository contract.

## Fresh verification evidence

GitHub Actions run: https://github.com/epivene/adventure-zone-command-center/actions/runs/31726675620

Commit tested: `81444097bfbf1470746c0121bd07713b0dbbc354`

- Frozen lockfile install: passed.
- Hierarchy verification script tests: 1 file, 13 tests passed.
- Full API suite: 77 files passed, 1 skipped; 1,041 tests passed, 53 skipped.
- Full frontend suite: 28 files, 193 tests passed.
- Workspace library build/typecheck: passed.
- API typecheck: passed.
- Frontend typecheck: passed.
- API production build: passed.
- Frontend production build: passed.
- Water Lantern production-data verification: not runnable because the branch runner had no `DATABASE_URL`; the workflow recorded this explicitly. No database credential was invented or bypassed.

The temporary branch-only workflow was removed after this successful post-integration run.
