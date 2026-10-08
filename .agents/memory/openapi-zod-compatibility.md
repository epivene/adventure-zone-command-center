---
name: Generated validator compatibility
description: Orval generation must work across the catalog's Zod 3 and artifact-level Zod 4 aliases.
---

Pin generated validators to the Zod 3 API rather than relying on automatic version detection. Keep generated path-string validators compatible with both versions; do not coerce UUID strings before applying the UUID format.

**Why:** Orval can fall back to Zod 4 output when package detection fails, even though the shared validator package uses the Zod 3 catalog. Artifact-level aliases then compile that same generated source against Zod 4, where coercion wrappers do not support the same chained string-format methods.

**How to apply:** Check both shared-library generation and artifact compilation after OpenAPI changes. Keep JSON date-time values as strings unless the fetch layer actually converts them into Dates.
