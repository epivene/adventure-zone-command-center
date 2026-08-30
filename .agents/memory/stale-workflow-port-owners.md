---
name: Stale workflow port owners
description: How to interpret a managed workflow that rebuilds successfully but cannot bind its configured port.
---

If a managed workflow restart logs `EADDRINUSE`, do not assume the newly built process is serving requests. An orphaned process may still own the port and continue serving an older bundle, making live behavior disagree with current code and passing tests.

**Why:** A Design Studio authorization fix rebuilt successfully more than once, but endpoint checks continued returning the old response because an earlier API process still owned port 8080.

**How to apply:** When fresh code and live responses disagree, inspect active processes for duplicate servers. Stop the orphan, restart the managed workflow, and confirm the new startup log binds successfully before testing endpoints again.