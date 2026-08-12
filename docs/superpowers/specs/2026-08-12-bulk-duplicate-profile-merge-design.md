# Bulk Duplicate Profile Merge Design

## Goal

Let the user merge every duplicate organization/profile group into its already selected primary without reviewing and submitting hundreds of groups individually.

## User experience

- The duplicate profiles page keeps the existing per-group primary selection and individual merge controls.
- A prominent **Merge all duplicate groups** action appears above the groups and includes the current group count.
- Selecting it opens one confirmation that explains the operation: linked contacts, bookings, follow-ups, activities/history, and ACT source links move to each group's marked primary; the redundant profiles are then removed.
- After confirmation, the page submits the existing safe per-group merges sequentially and shows determinate progress, for example **Merging 83 of 496**.
- Controls that could change a primary or start another merge are disabled while bulk merging is active.
- Successfully merged groups disappear from the remaining work and stay complete even if a later group fails.
- If a request fails or the browser disconnects, the page stops with a useful error and a **Resume remaining merges** action. Resume uses the refreshed duplicate list, so already completed groups are not submitted again.
- When no duplicate groups remain, the page shows a success message and returns to the normal empty duplicate state.

## Primary selection

For every group, the bulk action uses the same profile already marked **Primary** by the page. It does not silently replace or recalculate the user's current selections.

## Architecture and data flow

The feature reuses the existing `POST /organizations/merge` endpoint and its transactional repository operation. The client snapshots the current groups and primary selections, then processes one group at a time:

1. Send the selected primary ID and the other organization IDs for the next group.
2. Wait for success before processing the next group.
3. Record progress and remove the completed group from the visible queue.
4. Stop immediately on an error.
5. Refresh duplicates after completion or failure so the server remains the source of truth.

No new database schema or long-running Render request is required. Each group remains its own transaction, limiting lock duration and making partial progress safe and observable.

## Data safety

- The existing merge transaction continues to re-parent contacts, organization-contact relationships, bookings, follow-ups, activities, call sessions, ACT external links, and ACT migration entity pointers before deleting redundant organizations.
- A group is never submitted unless it has one selected primary and at least one distinct duplicate.
- The UI asks for explicit confirmation because deleting redundant profile rows is not reversible through the interface.
- Bulk processing is sequential to avoid concurrent merges touching overlapping relationship data.
- Failure does not roll back prior successful groups; the refreshed list accurately represents remaining work.

## Error handling

- The bulk loop stops on the first failed group rather than continuing with uncertain state.
- The message identifies the group name and how many groups completed.
- Resume re-fetches duplicates and starts from the remaining server-reported groups.
- Individual merge controls remain available after a stopped run.

## Testing

- A UI test proves the bulk action sends every group using its selected primary, processes requests sequentially, and reaches the completed state.
- A UI test proves a failure stops later submissions and exposes resume behavior.
- A UI test proves confirmation cancellation performs no merges.
- Existing API/repository tests continue to verify that a group merge preserves and re-parents linked data.
- The production frontend and API builds must succeed before publishing.

## Out of scope

- Changing duplicate detection rules.
- Automatically choosing a different primary than the one already marked.
- Undoing completed merges.
- Adding a durable background-job subsystem.
