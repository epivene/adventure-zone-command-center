---
name: Canvas presentation
description: Non-obvious identifiers required when verifying and presenting mockup-sandbox frames.
---

For canvas mockups, screenshot resolution uses the registered artifact directory label without the `artifacts/` prefix, while `presentArtifact` requires the artifact's registered ID.

**Why:** The filesystem path and registered artifact identity are represented differently by the canvas tools, so passing one in place of the other fails even when the preview is healthy.

**How to apply:** Use the exact directory label from the registered artifact list for screenshots, and the exact artifact ID for presentation; keep the iframe preview path relative to the mockup artifact.