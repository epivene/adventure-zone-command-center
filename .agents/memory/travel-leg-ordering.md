---
name: Travel leg ordering invariant
description: Sort-order model for active vs archived travel legs and where it is enforced.
---

## Rule
Travel legs keep one contiguous `sort_order` sequence 1..N: active legs occupy 1..A (user-chosen order), archived legs occupy A+1..N (relative order preserved). Configuration (rename/reorder/details) applies to active legs only; archive, restore, and add renormalize the full sequence.

**Why:** The `sort_order` column is UNIQUE with a 1–9 check; letting archived legs be reordered or edited corrupted the active ordering model (completion review rejection). Enforcing the invariant server-side in `TravelLegService` keeps every mutation path (archive/restore/add/delete/configure) consistent regardless of UI.

**How to apply:** Any new mutation of travel legs must go through the service's normalize helpers, and pickers for new assignments must use the active-only listing while still rendering an archived leg already attached to a record.
