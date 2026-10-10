---
name: Profile email access by role
description: Email history and draft links on profiles must stay within each workspace's authorization.
---

Office profile email highlights come from the signed-in Office account's own drafts and link back to the Office Emails workspace. They must not load owner Google mail. Boss profile previews use Boss-authorized Google email reads and remain read-only; the full view stays in the Boss profile's Emails section.

**Why:** The workspaces expose different email capabilities: Office manages its account-scoped drafts, while Boss can read approved profile conversations through separate read-only endpoints.

**How to apply:** When adding profile email history, choose the role's own API and route rather than reusing an owner endpoint or assuming workspaces share mailbox permissions.
