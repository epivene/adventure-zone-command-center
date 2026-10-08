---
name: Vite offline cache boundary
description: Why development module requests must bypass production offline asset validation.
---

Keep development source/module URLs out of production offline asset validation. Do not relax production CSS MIME checks to accommodate development.

**Why:** Vite serves imported CSS as JavaScript. Treating those requests as production CSS can make the first page load succeed, then reject its startup modules after the service worker takes control.

**How to apply:** When a preview works once but later stays on the startup fallback with generic network failures, inspect the service worker and response MIME types before changing app routing. Verify production cache safety and development bypass separately.
