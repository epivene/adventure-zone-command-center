---
name: Review-due removal semantics
description: How to remove synthetic review-due work without damaging event history.
---

Review-due rows are computed from completed bookings that lack a manager review. Removing one must create or update a dismissal record rather than deleting the booking or fabricating a review. Deleting a saved review must also create a dismissal so the same event does not immediately reappear as review-due.

**Why:** Review-due is not a standalone task row. Deleting source records would destroy operational history, while a dismissal preserves the decision and keeps the item from reappearing.

**How to apply:** Any Boss or admin action that hides a review-due item or deletes a completed review should use the dismissal lifecycle and attribution. Completed reviews remain separate persisted records until explicitly deleted.