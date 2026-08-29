---
name: Canvas presentation
description: Non-obvious identifiers required when verifying and presenting mockup-sandbox frames.
---

For canvas mockups, screenshot resolution uses the registered artifact directory label without the `artifacts/` prefix, while `presentArtifact` requires the artifact's registered ID. Canvas iframe URLs must contain the resolved development domain, not a literal `$REPLIT_DEV_DOMAIN` placeholder.

**Why:** The filesystem path and registered artifact identity are represented differently by the canvas tools, and unresolved environment placeholders make an otherwise healthy sandbox preview appear broken.

**How to apply:** Use the exact directory label from the registered artifact list for screenshots, and the exact artifact ID for presentation; keep the iframe preview path relative to the mockup artifact.