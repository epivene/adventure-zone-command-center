---
name: Campaign delivery approval boundary
description: Durable safety rules for bulk marketing sends and their delivery history.
---

Bulk campaign delivery must use an immutable recipient-and-copy snapshot created at review time. Any audience eligibility or membership change invalidates approval and requires a fresh review. Test sends target only an explicitly entered address and never mutate audience delivery state. A campaign is sent only from approved or due-scheduled state, and history records provider-confirmed per-recipient outcomes rather than manual status changes.

**Why:** Bulk email mistakes affect many contacts at once. Communication blocks, invalid addresses, stale audiences, unresolved placeholders, duplicate workers, and simulated sent states must fail closed rather than create accidental or misleading delivery.

**How to apply:** Preserve this boundary whenever campaign editing, audience management, scheduling, retries, mail providers, or delivery reporting changes. Keep per-recipient claims idempotent and retain provider message IDs and failures for auditability.