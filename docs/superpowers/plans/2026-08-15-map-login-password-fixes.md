# Map, Manager Login, and Manager Password Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blank route map, make Manager Portal sign-in directly reachable from the signed-out experience, and prevent two manager/leg accounts from sharing the same password.

**Architecture:** Keep the existing route-geocoding and manager-authentication systems. Repair the Vite/MapLibre integration and viewport behavior in the frontend, expose two explicit public authentication paths, and enforce password uniqueness server-side by verifying the candidate plaintext against every other stored manager hash/salt before hashing and saving it.

**Tech Stack:** React + TypeScript, Vite, MapLibre GL, Vitest + Testing Library, Express, Drizzle ORM/PostgreSQL, existing scrypt manager-password helpers, GitHub Actions.

## Global Constraints

- Use `import.meta.env.VITE_MAP_STYLE_URL` for custom map-style configuration.
- If no custom map style is configured, use a real public MapLibre-compatible basemap rather than the current background-only gray fallback.
- A map/style load failure must be visible in Routes.
- One visible marker must center at city-level zoom; multiple visible markers must use `fitBounds` with padding.
- Signed-out users must see separate **Admin / Command Center** and **Manager Portal** actions.
- Admin routes to `/sign-in`; Manager Portal routes to `/manager/sign-in`.
- Manager credentials must be sent only to `/api/manager/auth/login`, never `/api/auth/login`.
- Manager passwords must be unique across all configured manager/leg access records, including archived legs.
- Exclude the current manager/leg from its own uniqueness comparison.
- Passwords remain salted/hashed and must never be stored, logged, audited, or returned in plaintext.
- Duplicate password conflicts return HTTP `409` with `That password is already assigned to another manager. Choose a different password.` and must not identify the conflicting manager.
- Preserve manager session invalidation, token format/expiry, owner auth, city/state geocoding, Location needs mapping retry, finance, receipts, trips, handoffs, route filters, and travel-leg IDs.

---

## File Structure

- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx` — real Vite-compatible basemap, map-error state, auto-fit.
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx` — style, error, one-marker and multi-marker tests.
- Modify: `artifacts/adventure-zone/src/App.tsx` — explicit public Admin and Manager entry points; export `Landing` for focused testing.
- Create: `artifacts/adventure-zone/src/AppLanding.test.tsx` — exact landing-link coverage.
- Modify: `artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx` — preserve manager sign-in UI behavior.
- Create: `artifacts/adventure-zone/src/lib/manager-auth-context.test.tsx` — verify manager sign-in endpoint isolation.
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts` — internal list of all configured password hash/salt records, including archived legs.
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts` — uniqueness check before hashing/saving.
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.test.ts` — duplicate/self/distinct/non-disclosure coverage.
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx` — preserve server duplicate-password error text.
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx` — card-local portal error state.
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx` — inline conflict coverage.
- Modify: `.github/workflows/calendar-route-handoff-ci.yml` — run all new focused tests.

---

### Task 1: Replace the Blank Map Fallback With a Real Basemap

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Produces `DEFAULT_MAP_STYLE_URL: string`.
- Produces `resolveMapStyle(configured?: string): string`.
- `MapCanvas` reports a visible map load error through `onError`.

- [ ] **Step 1: Add failing map-style tests**

```ts
it("uses the configured Vite map style", () => {
  expect(resolveMapStyle("https://example.com/style.json"))
    .toBe("https://example.com/style.json");
});

it("uses a real fallback basemap", () => {
  expect(resolveMapStyle(undefined)).toBe(DEFAULT_MAP_STYLE_URL);
  expect(DEFAULT_MAP_STYLE_URL).toMatch(/^https:\/\//);
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: FAIL because those exports do not exist and the component still uses `process.env.NEXT_PUBLIC_MAP_STYLE_URL` plus the gray background-only fallback.

- [ ] **Step 3: Implement Vite-compatible style selection**

```ts
export const DEFAULT_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export function resolveMapStyle(configured?: string) {
  return configured?.trim() || DEFAULT_MAP_STYLE_URL;
}
```

Construct the map with:

```ts
style: resolveMapStyle(import.meta.env.VITE_MAP_STYLE_URL),
```

- [ ] **Step 4: Add failing error-state coverage**

Trigger the MapLibre `error` callback in the mock and assert:

```tsx
expect(await screen.findByRole("alert")).toHaveTextContent(
  "The map background could not be loaded."
);
```

- [ ] **Step 5: Implement visible map errors**

Add `onError?: (message: string) => void` to `MapCanvas`, register:

```ts
map.on("error", () => onError?.("The map background could not be loaded."));
```

In `EventMap`, keep `mapError` state and render it above the map with `role="alert"`.

- [ ] **Step 6: Run map tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/event-map.tsx artifacts/adventure-zone/src/components/routes/event-map.test.tsx
git commit -m "fix: load a real route basemap"
```

---

### Task 2: Auto-Fit the Map to Visible Events and Handoffs

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Produces `visibleCoordinates(geoJson, handoffs): [number, number][]`.
- One point → `easeTo({ center, zoom: 10, duration: 0 })`.
- Multiple points → `fitBounds(..., { padding: 48, maxZoom: 10, duration: 0 })`.

- [ ] **Step 1: Add failing viewport tests**

For Miles City:

```ts
expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
  center: [-105.8406, 46.4083],
  zoom: 10,
}));
```

For two points:

```ts
expect(map.fitBounds).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({ padding: 48, maxZoom: 10 }),
);
```

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: FAIL because the viewport stays at the hard-coded continental center/zoom.

- [ ] **Step 3: Implement coordinate collection**

```ts
function visibleCoordinates(
  geoJson: MapFeatureCollection,
  handoffs: HandoffFeatureCollection,
): [number, number][] {
  return [
    ...geoJson.features.map((feature) => feature.geometry.coordinates),
    ...handoffs.features.map((feature) => feature.geometry.coordinates),
  ];
}
```

- [ ] **Step 4: Fit after load and when visible data changes**

```ts
if (coordinates.length === 1) {
  map.easeTo({ center: coordinates[0], zoom: 10, duration: 0 });
} else if (coordinates.length > 1) {
  map.fitBounds(bounds, { padding: 48, maxZoom: 10, duration: 0 });
}
```

Use MapLibre `LngLatBounds`; run after layer/source setup and after event/handoff source updates.

- [ ] **Step 5: Run map tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/routes/event-map.tsx artifacts/adventure-zone/src/components/routes/event-map.test.tsx
git commit -m "fix: fit route map to visible markers"
```

---

### Task 3: Give Signed-Out Users Separate Admin and Manager Entry Points

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Create: `artifacts/adventure-zone/src/AppLanding.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx`
- Create: `artifacts/adventure-zone/src/lib/manager-auth-context.test.tsx`

**Interfaces:**
- `Landing` is exported from `App.tsx` for focused testing.
- Admin link → `/sign-in`.
- Manager link → `/manager/sign-in`.
- `ManagerAuthProvider.signIn(legId, password)` → `/api/manager/auth/login` only.

- [ ] **Step 1: Create the failing landing test**

`AppLanding.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { Landing } from "./App";

afterEach(cleanup);

describe("signed-out landing", () => {
  it("offers separate admin and manager entry points", () => {
    const { hook } = memoryLocation({ path: "/" });
    render(<Router hook={hook}><Landing /></Router>);
    expect(screen.getByRole("link", { name: "Admin / Command Center" }))
      .toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Manager Portal" }))
      .toHaveAttribute("href", "/manager/sign-in");
  });
});
```

- [ ] **Step 2: Create the manager endpoint test**

`manager-auth-context.test.tsx` must mock `global.fetch`, render a probe under `ManagerAuthProvider`, call `signIn("leg-kristy", "secret")`, and assert the URL ends in `/api/manager/auth/login`, with no call ending in `/api/auth/login`.

Successful response body:

```ts
{
  token: "manager-token",
  manager: { legId: "leg-kristy", legName: "Kristy", managerName: "Kristy" },
}
```

- [ ] **Step 3: Run and confirm failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/AppLanding.test.tsx src/lib/manager-auth-context.test.tsx src/pages/ManagerSignInPage.test.tsx
```

Expected: landing test FAIL because `Landing` is not exported and only the generic owner sign-in action exists. The manager endpoint test documents the already-correct manager request path.

- [ ] **Step 4: Implement the two landing choices**

Export `Landing` and replace the single button with:

```tsx
<div className="mt-8 grid w-full max-w-sm gap-3">
  <Link className="button-primary px-6 py-3 text-center" href="/sign-in">
    Admin / Command Center
  </Link>
  <Link className="button-secondary px-6 py-3 text-center" href="/manager/sign-in">
    Manager Portal
  </Link>
</div>
```

- [ ] **Step 5: Run sign-in tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/AppLanding.test.tsx src/lib/manager-auth-context.test.tsx src/pages/ManagerSignInPage.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/AppLanding.test.tsx artifacts/adventure-zone/src/lib/manager-auth-context.test.tsx artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx
git commit -m "fix: separate admin and manager sign in"
```

---

### Task 4: Enforce Unique Manager Passwords Server-Side

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.test.ts`

**Interfaces:**
- Produces:

```ts
listConfiguredPasswordRecords(): Promise<Array<{
  legId: string;
  passwordHash: string;
  passwordSalt: string;
}>>
```

- Consumes `verifyLegManagerPassword(password, hash, salt)`.
- Duplicate on another leg → HTTP `409`.

- [ ] **Step 1: Add failing duplicate-password tests**

Other-leg conflict:

```ts
mocks.listConfiguredPasswordRecords.mockResolvedValue([
  { legId: "leg-amy", passwordHash: "hash-amy", passwordSalt: "salt-amy" },
]);
mocks.verifyPassword.mockResolvedValue(true);

const response = await request(app())
  .put("/manager-admin/legs/leg-kristy/access")
  .send({ password: "shared-secret" });

expect(response.status).toBe(409);
expect(response.body.error).toBe(
  "That password is already assigned to another manager. Choose a different password.",
);
expect(mocks.setPassword).not.toHaveBeenCalled();
```

Add tests proving:
- same `legId` is skipped and succeeds;
- distinct password succeeds when verifier returns false;
- an archived-leg access record still conflicts because all configured access rows are checked.

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts
```

Expected: FAIL because the route currently hashes/writes immediately.

- [ ] **Step 3: Implement repository access to all configured hashes**

```ts
async listConfiguredPasswordRecords() {
  return this.database
    .select({
      legId: legManagerAccess.legId,
      passwordHash: legManagerAccess.passwordHash,
      passwordSalt: legManagerAccess.passwordSalt,
    })
    .from(legManagerAccess);
}
```

Do not filter on active travel legs.

- [ ] **Step 4: Check uniqueness before hashing**

```ts
for (const record of await repo.listConfiguredPasswordRecords()) {
  if (record.legId === req.params.legId) continue;
  if (await verifyLegManagerPassword(
    p.data.password,
    record.passwordHash,
    record.passwordSalt,
  )) {
    res.status(409).json({
      error: "That password is already assigned to another manager. Choose a different password.",
    });
    return;
  }
}
```

Then hash and save normally.

- [ ] **Step 5: Add non-disclosure assertions**

```ts
const body = JSON.stringify(response.body);
expect(body).not.toContain("leg-amy");
expect(body).not.toContain("hash-amy");
expect(body).not.toContain("salt-amy");
expect(body).not.toContain("shared-secret");
```

- [ ] **Step 6: Run tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-admin.test.ts
git commit -m "fix: require unique manager passwords"
```

---

### Task 5: Show Password Conflicts Inside the Correct Manager/Leg Card

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`

**Interfaces:**
- Consumes API `409` error text from Task 4.
- Produces per-leg `portalErrors: Record<string, string>`.

- [ ] **Step 1: Add a failing inline-conflict test**

Mock `onSetManagerPassword` to reject with:

```ts
new Error("That password is already assigned to another manager. Choose a different password.")
```

After clicking Change password, assert the exact message appears and `Manager / Leg name` still contains `Kristy`.

- [ ] **Step 2: Run and confirm failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

- [ ] **Step 3: Implement card-local portal error state**

```ts
const [portalErrors, setPortalErrors] = useState<Record<string, string>>({});
```

Clear only the current leg's portal error before a password write. On rejection, store the thrown message and render it in that leg's Manager portal subsection. Do not clear normal leg fields or other legs' state.

- [ ] **Step 4: Preserve API error text in `RoutesPage`**

`handleSetManagerPassword` must let the API helper's server error propagate; do not replace a `409` with generic copy.

- [ ] **Step 5: Run editor tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/RoutesPage.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx
git commit -m "fix: show manager password conflicts inline"
```

---

### Task 6: Regression Verification and Delivery

**Files:**
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`

**Interfaces:**
- Consumes Tasks 1–5.
- Produces a merge-ready PR against current `main`.

- [ ] **Step 1: Add focused tests to CI**

Frontend focused step:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/travel-leg-editor.test.tsx \
  src/components/routes/event-map.test.tsx \
  src/AppLanding.test.tsx \
  src/pages/ManagerSignInPage.test.tsx \
  src/lib/manager-auth-context.test.tsx
```

Keep `src/routes/leg-manager-admin.test.ts` in the API focused step.

- [ ] **Step 2: Run focused regression tests**

```bash
pnpm --filter @workspace/api-server exec vitest run \
  src/routes/leg-manager-admin.test.ts \
  src/features/routes/location-resolver.test.ts \
  src/routes/routes-map.test.ts \
  src/features/routes/handoff-scoring.test.ts \
  src/features/trips/trip-service-handoff.test.ts

pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/travel-leg-editor.test.tsx \
  src/components/routes/event-map.test.tsx \
  src/AppLanding.test.tsx \
  src/pages/ManagerSignInPage.test.tsx \
  src/lib/manager-auth-context.test.tsx \
  src/features/calendar/month-spans.test.ts
```

Expected: PASS.

- [ ] **Step 3: Build both apps**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: both exit `0`.

- [ ] **Step 4: Run workspace typecheck**

```bash
pnpm run typecheck
```

Expected: exit `0`; if unrelated pre-existing failures reappear, no new errors may be in files touched by this plan.

- [ ] **Step 5: Compare with current `main`**

Confirm the implementation branch is based on latest `main`. Diff may contain only the map fix, public sign-in choice, password uniqueness/inline error behavior, focused tests/CI, and approved docs. Verify no regressions to finance, receipts, trips, handoffs, calendar, booking data, route geocoding, manager IDs, or session security.

- [ ] **Step 6: Open the PR**

PR body must state:
- real Vite-compatible basemap and auto-fit;
- direct Admin / Command Center and Manager Portal entry points;
- manager login isolated to `/api/manager/auth/login`;
- duplicate manager passwords rejected across active and archived manager records;
- no plaintext password exposure;
- finance, receipts, trips, handoffs, route geocoding, and session security preserved.
