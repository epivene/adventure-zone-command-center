---
name: Render startup readiness gate
description: Safety boundary between early port binding, database maintenance, internal imports, and worker startup.
---

Current feature prerequisites must be checked independently of the historical maintenance migration chain.

**Why:** An older incomplete migration can stop the maintenance loop before newer profile-field and event-date migrations run, while the API remains available. A migration file existing on disk does not mean it was registered or applied.

**How to apply:** Register required additive migrations in the explicit inventory and check the feature's dependencies before enabling normal API traffic. Do not apply unrelated historical repairs to unblock a new feature.

Bind the HTTP port before long database startup so Render can detect the service, but keep ordinary API traffic gated until required startup and post-listen database maintenance settle. The liveness endpoint and CORS OPTIONS preflights stay available, and the assistant-import namespace may pass through the gate only because every mounted route retains bearer-token authentication. Historical approved-profile replay is disabled unless explicitly opted in. Required-startup failure must close the server and process; handled optional-maintenance failure may open readiness.

**Why:** Render can terminate a healthy build before the API opens a port when serialized production schema checks exceed its port-detection window. Opening normal traffic before approved-profile maintenance settles lets page fan-out and polling compete with imports for the default ten-connection pool, causing acquisition timeouts; replaying the full archive on every deployment extends that outage unnecessarily.

**How to apply:** Close the gate before binding; allow exact liveness and authenticated internal-import routing; finish required startup and settle handled maintenance; open readiness; then start workers. Preserve fail-closed shutdown for required errors.