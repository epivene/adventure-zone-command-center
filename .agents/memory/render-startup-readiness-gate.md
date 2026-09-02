---
name: Render startup readiness gate
description: Safety boundary between early port binding, database maintenance, internal imports, and worker startup.
---

Bind the HTTP port before long database startup so Render can detect the service, but keep ordinary API traffic gated until required startup and post-listen database maintenance settle. The liveness endpoint stays available, and the assistant-import namespace may pass through the gate only because every mounted route retains bearer-token authentication. Required-startup failure must close the server and process; handled optional-maintenance failure may open readiness.

**Why:** Render can terminate a healthy build before the API opens a port when serialized production schema checks exceed its port-detection window. Opening normal traffic before approved-profile maintenance settles lets page fan-out and polling compete with imports for the default ten-connection pool, causing acquisition timeouts.

**How to apply:** Close the gate before binding; allow exact liveness and authenticated internal-import routing; finish required startup and settle handled maintenance; open readiness; then start workers. Preserve fail-closed shutdown for required errors.