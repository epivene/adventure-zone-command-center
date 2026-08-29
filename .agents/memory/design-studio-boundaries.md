---
name: Design Studio ownership boundary
description: Cross-workspace auth and schema integration decisions for the private Design Studio.
---

Marketing and Office requests use the same Design Studio ownership boundary: an authenticated owner session is mapped to the first enabled Office account when no Office bearer token is present, while Office roles continue to use their verified account.

**Why:** Marketing already has a private owner-authenticated workspace, but Studio records need the Office account scope used by existing permissions and audit records; rejecting owner sessions would make the new Marketing entry point unusable.

**How to apply:** Keep the fallback limited to Design Studio routes, preserve role checks for mutations, and do not broaden it to existing Office or communication-template endpoints.