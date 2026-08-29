---
name: Empty database bootstrap
description: Non-obvious constraints when initializing a blank Adventure Zone development database.
---

Use one aggregate Drizzle schema entry that exports every feature schema exactly once. When bootstrapping from exported SQL, create unique indexes before composite foreign keys and retain the canonical constraint/index names expected by required startup checks.

**Why:** Multi-entry Drizzle discovery treats imported dependency tables as rename candidates. Drizzle export also places unique indexes after foreign keys, which breaks composite references, while auto-generated object names and `NULLS LAST` index variants can fail strict startup verification even when structurally similar.

**How to apply:** This applies only to initializing an empty development database. Do not reset a database containing user data; use normal forward migrations there. After bootstrap, require all startup checks and an authenticated login request to pass.