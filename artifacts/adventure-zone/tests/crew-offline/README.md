# Production manager crew offline regression

Run from the workspace root:

```sh
BASE_PATH=/ VITE_API_BASE_URL= pnpm --filter @workspace/adventure-zone run test:crew-offline
```

Install Playwright Chromium first (`pnpm --filter @workspace/adventure-zone exec playwright install chromium`), or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to a compatible installed Chromium. On this Replit runtime it is `/repl/tools/bin/chromium`.

The command builds the real app and starts an isolated static/fixture HTTP server on port 4179. It does not use or change the CRM database, production accounts, or running preview services. The server refuses to reuse an occupied port. Private records are populated only by authorized app requests and read from actual browser IndexedDB. Shell preparation uses the existing production service-worker message protocol and manifest, without seeding CacheStorage.

The single browser journey signs in, selects a booking via its operations URL, verifies saved records, disconnects the entire browser context, reloads the protected route, and checks identity, event selection, venue, coordinates, addresses, multiline staff notes and unknown overnight/rig/hookup facts. HTML and compiled assets must come from the service worker and the fixture server must receive no requests during the offline reload. On reconnect it checks refreshed authorization and staff notes, assignment revocation with IDB cleanup, a second offline reload that cannot resurrect removed records, then session expiration and identity cleanup.

Chromium can reset the renderer's reported connectivity during a service-worker navigation even though context networking remains disabled. The test reapplies the physical connectivity state with CDP `Network.overrideNetworkState` after reload and asserts `navigator.onLine`. Context offline emulation still blocks all traffic, and server counters independently prove that neither static nor API requests escaped. Reconnection restores both traffic and renderer connectivity; the app's real `online` listeners perform authorization checks (no synthetic app events or mocked browser storage).

Test output (including an offline screenshot and failure trace) goes into the ignored workspace `tmp/crew-offline-results/` directory. Playwright configuration is separate from Vitest, so ordinary unit-test commands do not start a browser.
