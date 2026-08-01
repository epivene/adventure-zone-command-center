# Act! Category Batch Import Design

**Date:** 2026-07-27  
**Status:** Approved

## Goal

Make it safe and practical to import a large category of contacts from Act!
into the Command Center without accidentally approving hidden categories,
changing the shared Act! account, or losing the rest of the import when a few
contacts fail.

The immediate use case is importing the 1,427 contacts in the **New in Act!**
category while leaving the app-only contact, changed records, possible
matches, conflicts, and errors untouched.

## Safety rules

1. Bulk approval applies only to the category currently being viewed.
2. Selecting a category for bulk import clears selections from every other
   category so the apply action cannot include hidden decisions.
3. Categories without a safe one-way default, including possible matches and
   records changed in both systems, never receive a bulk-approval button.
4. Importing **New in Act!** only creates Command Center contacts and sync
   metadata. It never writes to or modifies Act!.
5. Sync remains manual. No scheduled or automatic import is introduced.
6. A failed contact does not stop the remaining approved contacts.
7. Failed contacts remain visible and retryable after the other contacts
   finish.

## User experience

### Category approval

The global **Approve safe defaults** button is replaced with a
category-specific action. For the active category, its label includes the
category name and available count, for example:

> Approve only New in Act! (1,427)

For a category with a safe default, pressing the button:

- clears all existing decisions;
- selects the safe decision for every actionable row in the active category;
- leaves every other category unselected; and
- updates the sticky action bar with the exact number approved.

The bulk button is not shown for **Changed in both**, **Possible matches**,
**Already matched**, **Missing from Act!**, or **Errors**. Individual decisions
continue to work as they do now.

### Applying batches

The app processes approved rows in batches of 50. The action bar remains
visible and reports progress, for example:

> Importing 350 of 1,427…

While the import is running:

- category switching, sync creation, decision controls, and apply controls are
  disabled;
- the page must not start a second import;
- completed batches are removed from the pending selection; and
- failed rows are recorded while processing continues with later batches.

The browser sends one batch at a time to the existing authenticated server
action. This keeps each request bounded and allows visible progress without
adding a background-job service.

### Completion and retry

When every batch has been attempted, the action bar shows one of:

- `1,427 contacts imported.`
- `1,420 imported · 7 need retry.`

If failures exist, the interface selects or exposes the failed rows and offers:

> Retry failed contacts

Retry submits only the failed rows. Successful rows are not repeated. The
operation-claim records remain the server-side idempotency guard if a request
is retried or the user refreshes.

## Applying a New in Act! row

The current apply flow re-fetches each Act! contact before pulling it. Doing
that for 1,427 new contacts would add 1,427 sequential Act! requests and make
the import vulnerable to API rate limits and long request times.

For **New in Act!** rows only, the apply service uses the Act! snapshot stored
in the approved preview. This is safe because:

- the operation only creates a new local contact;
- the preview is the record the user reviewed and approved;
- no Act! record is overwritten; and
- if Act! changes after the preview, the next manual sync reports that contact
  as changed in Act!.

All decisions that can overwrite an existing local record, link records, or
write to Act! retain the current per-row re-fetch and concurrency checks.

The server must reject the snapshot shortcut unless all of these are true:

- the row category is `new_in_act`;
- the decision is `pull`;
- there is no local contact ID;
- an Act! record ID is present; and
- the stored Act! snapshot is present.

## Failure handling

Server results remain per-row. A row can complete, be skipped, or fail without
changing the result of another row.

The client collects row failures across batches and continues importing later
batches. A batch-level network or server failure pauses the import, preserves
that batch and all later rows for retry, and explains that the connection was
interrupted. If the response is unknown, idempotent operation claims prevent
already-completed rows from being duplicated when the batch is retried.

Errors shown to the user remain sanitized and must not expose Act!
credentials, database details, or raw upstream responses.

## Accessibility and placement

Progress and completion messages live inside the sticky action bar rather than
at the bottom of the page. They use an `aria-live="polite"` region.

Buttons have explicit labels that name the affected category. Progress is
communicated with text, not color alone. Disabled controls remain visibly
disabled while work is in progress.

## Verification

Automated tests must cover:

- category approval selects only the active category;
- category approval clears hidden selections;
- unsafe categories have no bulk-approval action;
- 1,427 decisions are submitted as 29 batches, with at most 50 rows per batch;
- progress advances after each completed batch;
- individual row failures do not stop later batches;
- retry includes only failed rows;
- successful rows are not submitted again;
- a `new_in_act` pull uses its stored preview snapshot without an Act! detail
  request;
- other pull, link, update, and push decisions retain remote re-fetch checks;
- malformed snapshot-shortcut rows fail safely; and
- the existing single-row and conflict-review behavior remains unchanged.

## Out of scope

- automatic or scheduled Act! sync;
- importing more than one category with one bulk action;
- automatically resolving possible matches or conflicts;
- adding a background queue or worker;
- changing the existing shared-account credentials; and
- redesigning the rest of the Contacts or Act! settings pages.
