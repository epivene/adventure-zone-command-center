# ACT Note Ownership Repair Rerun

## Problem
The ACT Recovery page reused the fixed full-recovery request key. Once that run was complete, clicking Resume Recovery returned the old terminal classification instead of reprocessing existing ACT timeline records whose profile ownership was wrong.

## Behavior
- A completed recovery offers **Repair ACT Note Ownership**.
- Each repair click creates a brand-new request key so prior `already_present` results cannot suppress reprocessing.
- Repair runs contain only `note`, `history`, and `activity` archive records.
- Existing timeline recovery logic re-resolves exact ACT relationships, removes stale ownership, and attaches the record to proven owners.
- Unresolved ownership remains in Recovery Review.
- Repair status uses plain labels: **ACT notes checked**, **Already correct**, **Moved / repaired**, and **Needs review**.
- The action may be run again later; every click creates a fresh repair generation.

## Safety
No ACT archive source data is deleted. The repair reuses the existing ownership reconciliation rules and manual review fallback.
