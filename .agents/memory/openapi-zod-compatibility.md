---
name: Generated validator compatibility
description: Orval generation must work across the catalog's Zod 3 and artifact-level Zod 4 aliases.
---

Pin generated validators to the Zod 3 API rather than relying on automatic version detection. Keep generated path-string validators compatible with both versions; do not coerce UUID strings before applying the UUID format.

**Why:** Orval can fall back to Zod 4 output when package detection fails, even though the shared validator package uses the Zod 3 catalog. Artifact-level aliases then compile that same generated source against Zod 4, where coercion wrappers do not support the same chained string-format methods.

**How to apply:** Check both shared-library generation and artifact compilation after OpenAPI changes. Keep JSON date-time values as strings unless the fetch layer actually converts them into Dates.

Avoid introducing DOM-only types into the shared server validator library when documenting raw file uploads.

**Why:** Orval turns `format: binary` into a `Blob` type, but the shared validator library does not include DOM type definitions.

**How to apply:** For OpenAPI 3.1 raw PDF uploads, document the application/pdf body and raw-byte semantics without a DOM-only format, or explicitly resolve Node-compatible binary typing. Regenerate and run the shared-library check; do not hand-edit generated types.

Bare Zod aliases must not rewrite explicit versioned imports.

**Why:** Introducing drizzle-zod exposed a prefix-alias issue in both build tools: `zod/v4` became `zod/v4/v4`. Library typechecks and focused tests passed even though production builds failed.

**How to apply:** Match only bare `zod`, or protect explicit versioned subpaths before the prefix alias. Verify both the frontend and API production builds when adding libraries that import Zod directly.
