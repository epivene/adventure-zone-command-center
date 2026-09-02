---
name: Render startup readiness gate
description: Safety boundary between early port binding and required database startup checks.
---

Bind the HTTP port before long required-schema checks so Render can detect the service, but allow only the liveness endpoint until every required schema check and required seed succeeds. Required-startup failure must close the server and process; optional post-listen maintenance remains non-fatal.

**Why:** Render can terminate a healthy build before the API opens a port when serialized production schema checks exceed its port-detection window. Moving those checks after `listen()` without a traffic gate would expose routes against an incomplete schema.

**How to apply:** Keep the startup gate closed before binding, exempt only the exact liveness route, open the gate after required startup succeeds, and preserve fail-closed shutdown for required errors. Run maintenance and workers only afterward.