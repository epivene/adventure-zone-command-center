# Manager Event Lifecycle + Operations Design

## Goal
Connect the existing Leg Manager crew, money/receipts, event review, and incident tools into one coherent event lifecycle while adding safe permanent worker deletion and practical receipt capture.

The operational lifecycle is:

**Booked → Check in → At event → Check out → Wrap-up incomplete → Finished**

## 1. Permanent worker deletion

### Permissions
- A Leg Manager may permanently delete a worker only when that worker has records belonging to the manager's own leg.
- Admin may permanently delete any worker company-wide.
- A Leg Manager may not delete a worker that has no relationship to their leg.

### Confirmation
Deletion is irreversible and must never happen from a single tap.

Flow:
1. User taps **Delete worker**.
2. Confirmation panel names the worker and explains that the worker plus associated history will be permanently deleted.
3. User must tap a second explicit **Delete [Worker Name]** action.
4. On success, return to the crew list and remove the worker from search/results immediately.

### Cascade behavior
Permanent worker deletion removes the worker and records that exist only to describe that worker, including:
- work-history entries
- ratings stored on those work-history entries
- manager notes attached to that worker
- worker-specific event history links

Do not leave anonymous "Deleted worker" history rows.

The deletion must not remove unrelated bookings, trips, events, finance entries, or other workers.

## 2. Receipt capture and scanning

The existing receipt metadata/image upload and offline retry system remains the storage/sync foundation.

### Entry points
The Receipts page must no longer require an expense to exist first. It gets two primary actions:
- **+ Add receipt**
- **Add expense manually**

### Add receipt flow
1. Manager takes a photo with the rear camera or chooses an existing image.
2. The app stores the original image locally/offline immediately using the existing receipt queue pattern.
3. Receipt extraction attempts to read:
   - merchant
   - total
   - tax
   - transaction date
4. The manager sees a review form with those suggested values.
5. All suggested values are editable before saving.
6. The manager selects/edits expense category, payment source, optional event/trip association, and notes as needed.
7. Save creates the expense and attaches the receipt image.

If extraction fails, the manager still keeps the photo and gets a normal manual expense form rather than losing the capture.

### Extraction architecture
Use the existing AI/provider infrastructure when available for receipt understanding rather than creating a second AI account/provider path. Receipt extraction is assistive only: it proposes fields and never finalizes money records without manager confirmation.

### Offline behavior
- Camera/photo capture must work offline.
- Expense draft and receipt image remain queued locally.
- When connectivity returns, expense metadata syncs first, then receipt metadata/image upload retries independently.
- Failed image upload must not delete or roll back the saved expense.

## 3. Event check-in / check-out

### Eligibility
Check-in/out is available for booked/confirmed events assigned to the authenticated manager's travel leg.

### Check in
**Check in** records:
- booking/event ID
- leg ID
- check-in timestamp
- optional latitude/longitude when location permission is available
- location capture status so the system can distinguish "permission unavailable" from a real saved location

GPS is optional. Declining or failing location permission never blocks check-in.

After check-in, the manager surfaces show **Checked in** with the recorded arrival time.

### Check out
**Check out** records the same shape for departure:
- checkout timestamp
- optional location

Checkout itself succeeds before wrap-up begins, so a later wrap-up error cannot erase the checkout record.

### State rules
- Cannot check out before checking in unless Admin explicitly corrects/imports the event state.
- Repeated taps are idempotent and do not create duplicate check-ins/checkouts.
- The current state appears consistently on Manager Home, Schedule/event detail, and the event wrap-up.

## 4. Checkout launches resumable Event Wrap-Up

Immediately after a successful checkout, open the existing manager event wrap-up for that booking.

The wrap-up acts as a resumable checklist composed from existing systems rather than a new duplicate data model:
- Event review/rating
- Crew/work-history and crew notes
- Money / expenses / receipts
- Incident/issues/notes
- Existing event wrap-up calculator/finance sections

### Finish later
The wrap-up provides:
- **Finish wrap-up**
- **Finish later**

**Finish later** preserves every section already saved and records the wrap-up as incomplete. The user does not have to complete every section in one session.

### Resume paths
Incomplete wrap-ups are surfaced prominently in two places:
- Manager Home: **Finish event wrap-up** near the top of the work queue
- Manager Schedule/event detail: completed event shows **Wrap-up incomplete** and opens the same wrap-up

Returning to the wrap-up shows current persisted state; it does not start over.

### Completion
A wrap-up reaches **Finished** when required completion conditions are met and the manager taps Finish. Optional sections may remain empty.

## 5. Event reviews

The current due-review system remains authoritative:
- it looks at bookings assigned to the manager's leg
- it excludes events already reviewed
- it makes a review due once the event's effective end date is before the current business date

Checkout improves this rather than replacing it:
- the wrap-up opens the event review immediately after checkout
- completing the review there satisfies the same existing event-review record
- if the manager chooses Finish later without completing the review, the normal due-review mechanism still surfaces it afterward

Do not create a second review table or duplicate review request system.

## 6. Admin behavior

Admin needs operational oversight without impersonating the Leg Manager.

Admin can:
- permanently delete any worker using the same strong confirmation pattern
- view check-in/check-out timestamps and optional locations for any event
- see incomplete wrap-ups across legs
- open the existing admin aftermath/wrap-up views
- correct event lifecycle state if necessary through an explicit admin action/history entry

Admin does not silently alter manager check-in/out history; corrections should remain attributable.

## 7. UI principles

Keep the current simple-surface rule:
- common event actions visible at the point of work
- less-common details one level deeper
- no duplicate standalone workflows when an existing system can be reused

### Manager Home
For the relevant event, show one lifecycle action at a time:
- upcoming: **Check in**
- checked in: **Check out**
- checked out/incomplete: **Finish event wrap-up**
- finished: no urgent lifecycle action

### Schedule/event detail
Show current state and timestamps, with the same available action.

### Receipts
The empty state should provide the actions instead of only saying "No expenses yet."

### Crew
Worker detail/list provides Delete only when the current user has permission.

## 8. Data and API boundaries

Prefer extending existing Leg Manager tables/repositories and existing booking IDs/leg IDs.

New lifecycle persistence should use booking + leg as the durable ownership boundary. Check-in/out and wrap-up status must not depend on a Trip row existing, because confirmed bookings can be assigned directly to a leg before a formal Trip is created.

Existing finance, receipt, review, incident, worker, booking, and trip records remain the source of truth for their own domains.

## 9. Safety and failure behavior

- Worker deletion: transactionally delete worker-owned child records with the worker; rollback on failure.
- Receipt extraction: failure falls back to editable manual fields.
- Offline receipt upload: retries without duplicating expenses.
- Check-in/out: idempotent and survives refresh/retry.
- Location: optional and never blocks check-in/out.
- Checkout: persist checkout before opening wrap-up.
- Wrap-up: partial progress is saved section-by-section; Finish later never discards saved data.
- Cross-leg permissions remain server-enforced, not just hidden in the UI.

## 10. Testing

Add focused tests for:
- manager can delete a worker associated with their leg
- manager cannot delete an unrelated worker
- admin can delete any worker
- worker delete cascades worker history/ratings/notes but not unrelated event records
- destructive confirmation requires the second named action
- Receipts empty state exposes Add receipt and manual expense
- receipt extraction suggestions populate merchant/total/tax/date and remain editable
- extraction failure still permits manual save with the captured image
- offline receipt queue preserves expense + image retry behavior
- check-in works with GPS, without GPS, and after permission denial
- duplicate check-in/out requests are idempotent
- manager cannot check in/out an event assigned to another leg
- checkout launches the correct booking wrap-up
- Finish later marks wrap-up incomplete and resume opens persisted state
- incomplete wrap-up appears on Manager Home and Schedule
- completing event review in wrap-up removes it from due reviews
- skipped review still becomes due through the existing mechanism

## Non-goals
- Do not create employee payroll/timeclock functionality.
- Do not require GPS or geofence validation.
- Do not replace the existing finance, receipt, event-review, incident, or crew systems.
- Do not create a second wrap-up data model when existing section records can represent progress.
- Do not auto-submit AI-extracted financial values without manager review.
