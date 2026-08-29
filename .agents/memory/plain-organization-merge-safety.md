---
name: Plain organization merge safety
description: Atomicity and preservation rules for deleting duplicate organization profiles.
---

# Plain organization merge safety

Plain duplicate merges must perform subset validation, relationship preparation, all reference re-parenting, conflict resolution, and duplicate deletion inside one outer database transaction.

**Why:** Preparation committed separately can leave a partially moved profile when a later constraint fails. New CRM tables also frequently use restrictive or cascading organization references, so an unaudited delete can either fail or silently erase history.

**How to apply:** Any schema addition containing an organization reference must be reviewed against both plain merge and location-preserving consolidation. For uniqueness conflicts, keep the survivor's canonical row but move or convert the duplicate's child/history rows before deleting it.