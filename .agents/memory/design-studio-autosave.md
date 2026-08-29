---
name: Design Studio autosave safety
description: Durable concurrency rule for preserving edits made while a Studio save request is in flight.
---

# Design Studio autosave safety

Autosave must track a monotonically increasing edit revision and clear dirty state only when the server acknowledgement matches the latest local revision.

**Why:** A user can keep editing while a save request is pending. Unconditionally marking the project clean when that older request returns silently loses the newer edits and falsely reports that everything was saved.

**How to apply:** Every persisted editor mutation must advance the revision. When an older save completes, leave the editor dirty and schedule another save after the in-flight request settles.