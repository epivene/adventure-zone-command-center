---
name: Plain organization merge safety
description: Atomicity and preservation rules for deleting duplicate organization profiles.
---

# Plain organization merge safety

Plain duplicate merges must perform subset validation, relationship preparation, all reference re-parenting, conflict resolution, and duplicate deletion inside one outer database transaction.

**Why:** Preparation committed separately can leave a partially moved profile when a later constraint fails. New CRM tables also frequently use restrictive or cascading organization references, so an unaudited delete can either fail or silently erase history.

**How to apply:** Any schema addition containing an organization reference must be reviewed against both plain merge and location-preserving consolidation. For uniqueness conflicts, keep the survivor's canonical row but move or convert the duplicate's child/history rows before deleting it.

Parent/member relationships can reference each other. Do not assume that deleting child rows first is always safe, even for temporary test records.

**Why:** A parent’s designated primary member can constrain deletion of membership rows that themselves reference the parent. A naïve child-first cleanup can fail despite targeting only verified test data.

**How to apply:** Inspect live foreign keys in both directions, lock and validate the exact target records, and detach any circular primary-member link within the same transaction before removal. Reject links to non-target records rather than expanding deletion scope.