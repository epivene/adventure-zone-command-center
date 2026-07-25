# Task 10 Report: Installable App and Connection-Loss Safety

## Implemented

- Added a standalone web-app manifest that opens at `/today`.
- Added valid 192×192 and 512×512 PNG application icons.
- Added a service worker that pre-caches only the public manifest and icons and
  runtime-caches only same-origin `/_next/static/`, `/icons/`, and manifest
  resources.
- Kept all navigations, HTML documents, API routes, auth routes, booking data,
  contacts, contracts, and notes outside Cache Storage.
- Added a responsive connection-loss banner and service-worker registration.
- Added versioned, timestamped, namespaced local draft storage with typed write
  failures.
- Added booking form draft handling:
  - offline changes are saved locally and labeled `Local draft — not saved`;
  - existing drafts are not applied until `Restore draft` is chosen;
  - network submission failures preserve a local draft;
  - rejected server saves retain the draft;
  - confirmed server saves remove the draft, while deletion failures remain
    visibly labeled.

## Verification

- `npm test`: PASS — 23 files, 97 tests.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS; `/manifest.webmanifest` is emitted as a static route.
- Service-worker unit contract: PASS; executes the real worker and verifies
  private API, authenticated HTML, and auth requests are never intercepted or
  cached.
- PNG asset contract: PASS; validates PNG signatures and exact dimensions.
- `npm run test:e2e -- tests/e2e/installable-offline.spec.ts`: BLOCKED before
  tests execute because the Next development server exhausts the environment's
  file-descriptor limit (`EMFILE: too many open files`). The manifest and cache
  boundaries retain static/unit coverage.

## Self-review

- Auth middleware, owner checks, and server actions are unchanged.
- Existing booking validation and redirect behavior are preserved.
- No private server-rendered HTML or response body is eligible for service-worker
  caching.
- Draft removal occurs only after the submission callback completes without an
  error result.
