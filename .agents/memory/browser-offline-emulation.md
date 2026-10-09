---
name: Browser offline emulation
description: Chromium connectivity-reporting caveat for production service-worker reload regressions.
---

Do not infer a fully offline device solely from `navigator.onLine`, or assume that reconnecting a browser context necessarily creates an `online` transition after a service-worker navigation.

**Why:** In this runtime, a service-worker-served navigation could reset the renderer's reported connectivity while Playwright context networking was disabled. Reconnecting then produced no new `online` event, despite later direct requests succeeding. Explicitly aligning Chromium's reported connectivity with the context's physical network state allowed the real application reconnect handlers to run. This was a browser-emulation issue, not evidence that the app's authorization handlers were broken.

**How to apply:** Production offline browser regressions should independently prove no static/API traffic reached the server, verify HTML and compiled assets were service-worker responses, and check actual private IndexedDB contents. Keep network blocking separate from renderer connectivity reporting, assert both after reload, and verify real reconnect authorization requests rather than forcing app-level events.
