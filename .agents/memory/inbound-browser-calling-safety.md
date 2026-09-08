---
name: Inbound browser calling safety
description: Durable privacy and ownership boundaries for browser-delivered Twilio calls and voicemail.
---

Inbound and outbound telephony flags are independent and fail closed. Only one authenticated browser may hold the renewable incoming-phone lease. Answered browser calls must never be recorded. Voicemail is not transcribed, and provider audio must be deleted after 30 days while metadata remains for audit/history.

Unknown caller snapshots are display-only. A callback becomes eligible only after an explicit link to an existing organization, contact, and stored phone row, with the normal Do Not Call and suppression checks applied. Verizon forwarding remains a manual carrier operation; the product may show `*72`/`*73` instructions but must not automate or claim to verify forwarding.

**Why:** These boundaries prevent multiple browsers from racing to answer, prevent accidental call recording or long-lived voicemail media, and ensure untrusted inbound metadata can never become a dialing destination.

**How to apply:** Preserve these invariants in every inbound webhook, availability lease, browser call control, voicemail API, retention worker, callback action, and rollout document. Keep both feature flags false until an explicitly reviewed provider rollout.