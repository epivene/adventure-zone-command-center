---
name: Manager crew offline authorization
description: Privacy and authorization boundaries for saved manager crew directions.
---

Offline crew availability is a read-only copy of records previously loaded through an assigned booking. Cache annual venue facts and saved crew-stop facts/notes only; do not persist an expanded organizer CRM response or external suggestions.

**Why:** Managers need directions without signal, but an offline cache must not expand access to unrelated CRM records or imply that unverified overnight parking is allowed.

**How to apply:** Use an explicit field allowlist and leg scope. Retain unknown rig-fit, hookup and overnight facts, plus text addresses and coordinates independent of map providers.

Fall back to saved crew records only for connectivity failures, never authorization denials. An offline copy does not establish current authorization.

**Why:** Revoked assignments cannot be discovered without a connection, and a denied online request must not reveal a previously authorized copy.

**How to apply:** Label offline copies as stale with their last-loaded time; recheck identity and assignments on reconnect. Purge on sign-out, leg changes and revoked assignments, and prevent late requests from repopulating cleared or revoked scopes.
