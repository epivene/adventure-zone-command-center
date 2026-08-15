# Map, Manager Login, and Manager Password Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the blank route map, make Manager Portal sign-in directly reachable from the signed-out experience, and prevent two manager/leg accounts from sharing the same password.

**Architecture:** Keep the existing route geocoding and manager authentication systems, but repair their integration points. The Vite frontend will own map-style selection and viewport fitting, the public landing page will expose the two authentication paths explicitly, and manager-password uniqueness will be enforced server-side by verifying the candidate password against every other stored manager hash/salt before writing a new hash.

**Tech Stack:** React + TypeScript, Vite, MapLibre GL, Vitest + Testing Library, Express, Drizzle ORM/PostgreSQL, existing manager scrypt password helpers, GitHub Actions.

## Global Constraints

- Use `import.meta.env.VITE_MAP_STYLE_URL` for custom map-style configuration.
- If no custom map style is configured, use a real public MapLibre-compatible basemap rather than the current background-only gray fallback.
- A style-load failure must be visible in the Routes UI.
- One visible route marker must center at a useful city-level zoom; multiple visible markers must use `fitBounds` with padding.
- Signed-out users must see separate **Admin / Command Center** and **Manager Portal** actions.
- **Admin / Command Center** routes to `/sign-in`; **Manager Portal** routes to `/manager/sign-in`.
- Manager credentials must be submitted only to `/api/manager/auth/login`, never `/api/auth/login`.
- Manager passwords must be unique across all configured manager/leg access records, including archived legs.
- The current manager/leg is excluded when checking its own password change.
- Passwords remain salted/hashed and must never be stored, logged, audited, or returned in plaintext.
- Duplicate password conflicts return HTTP `409` with copy equivalent to `That password is already assigned to another manager. Choose a different password.` and must not identify the conflicting manager.
- Preserve existing manager session-version invalidation, token format/expiry, owner/admin authentication, city/state geocoding, Location needs mapping retry behavior, finance, receipts, trips, handoffs, route filters, and travel-leg IDs.

---

## File Structure

**Map reliability**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx` — Vite map-style selection, real fallback style, map error state, marker auto-fit.
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx` — verify configured style, fallback style, one-point centering, multi-point fit, and style-error UI.

**Public authentication choice**
- Modify: `artifacts/adventure-zone/src/App.tsx` — replace the single signed-out `Sign in` action with Admin / Command Center and Manager Portal choices.
- Modify: `artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx` — preserve manager-sign-in behavior and assert manager endpoint usage through the auth context.
- Modify: `artifacts/adventure-zone/src/lib/manager-auth-context.test.tsx` if present; otherwise create it — verify `signIn()` posts to `/manager/auth/login` and never the owner endpoint.

**Unique manager passwords**
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts` — expose all configured password hash/salt records, including archived legs, without exposing them to HTTP responses.
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts` — perform uniqueness verification before hashing/writing the new password and return `409` on conflict.
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.test.ts` — active duplicate, archived duplicate, self-password, distinct-password, and non-disclosure coverage.

**Verification**
- Modify: `.github/workflows/calendar-route-handoff-ci.yml` — include the new focused tests in the existing feature verification job.

---

### Task 1: Replace the Blank Map Fallback With a Real Basemap

**Files:**
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/event-map.test.tsx`

**Interfaces:**
- Consumes: `import.meta.env.VITE_MAP_STYLE_URL`.
- Produces: `mapStyle()` or equivalent helper returning the configured style URL or the public fallback style URL.
- Produces: visible `mapError` UI when MapLibre emits a style/map error.

- [ ] **Step 1: Add failing style-selection tests**

Extract style choice into a small exported helper so it is deterministic in tests:

```ts
export const DEFAULT_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export function resolveMapStyle(configured?: string) {
  const trimmed = configured?.trim();
  return trimmed || DEFAULT_MAP_STYLE_URL;
}
```

Add tests:

```ts
it("uses a configured Vite map style", () => {
  expect(resolveMapStyle("https://example.com/style.json"))
    .toBe("https://example.com/style.json");
});

it("uses a real public basemap when no style is configured", () => {
  expect(resolveMapStyle(undefined)).toBe(DEFAULT_MAP_STYLE_URL);
  expect(DEFAULT_MAP_STYLE_URL).toMatch(/^https:\/\//);
});
```

- [ ] **Step 2: Run the focused map test and verify it fails**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: FAIL because `resolveMapStyle` and `DEFAULT_MAP_STYLE_URL` do not exist and the component still reads `process.env.NEXT_PUBLIC_MAP_STYLE_URL`.

- [ ] **Step 3: Replace the Next.js-style environment access and gray fallback**

Remove the background-only `fallbackStyle`. Add:

```ts
export const DEFAULT_MAP_STYLE_URL = "https://demotiles.maplibre.org/style.json";

export function resolveMapStyle(configured?: string) {
  const trimmed = configured?.trim();
  return trimmed || DEFAULT_MAP_STYLE_URL;
}
```

Construct MapLibre with:

```ts
style: resolveMapStyle(import.meta.env.VITE_MAP_STYLE_URL),
```

Do not reference `process.env.NEXT_PUBLIC_MAP_STYLE_URL` anywhere in the Vite frontend.

- [ ] **Step 4: Add failing visible-error coverage**

In the MapLibre test mock, capture registered `error` handlers and trigger one after render. Assert:

```tsx
expect(await screen.findByRole("alert")).toHaveTextContent(
  "The map background could not be loaded."
);
```

- [ ] **Step 5: Add map error state**

Inside `MapCanvas`, accept `onError?: (message: string) => void` and register:

```ts
map.on("error", () => {
  onError?.("The map background could not be loaded.");
});
```

In `EventMap`, keep:

```ts
const [mapError, setMapError] = useState<string | null>(null);
```

Render above the canvas:

```tsx
{mapError ? (
  <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
    {mapError}
  </p>
) : null}
```

- [ ] **Step 6: Run map tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

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
- Consumes: current visible `geoJson.features` and `handoffs.features`.
- Produces: `visibleCoordinates(...)` or equivalent pure helper returning `[longitude, latitude][]`.
- One coordinate calls `map.easeTo({ center, zoom: 10 })` or equivalent city-level zoom.
- Two or more coordinates call `map.fitBounds(bounds, { padding: 48, maxZoom: 10 })`.

- [ ] **Step 1: Add failing viewport tests**

Mock MapLibre instance methods `easeTo` and `fitBounds`.

Single Miles City marker:

```ts
expect(map.easeTo).toHaveBeenCalledWith(expect.objectContaining({
  center: [-105.8406, 46.4083],
  zoom: 10,
}));
```

Two markers:

```ts
expect(map.fitBounds).toHaveBeenCalledWith(
  expect.anything(),
  expect.objectContaining({ padding: 48, maxZoom: 10 }),
);
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: FAIL because the map currently stays at the hard-coded continental center/zoom.

- [ ] **Step 3: Implement visible-coordinate collection**

Add:

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

- [ ] **Step 4: Fit after map load and data updates**

Add a helper inside `MapCanvas`:

```ts
function fitVisibleData(map: MapLibreMap) {
  const coordinates = visibleCoordinates(eventDataRef.current, handoffDataRef.current);
  if (coordinates.length === 0) return;
  if (coordinates.length === 1) {
    map.easeTo({ center: coordinates[0], zoom: 10, duration: 0 });
    return;
  }
  const bounds = coordinates.reduce(
    (current, coordinate) => current.extend(coordinate),
    new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
  );
  map.fitBounds(bounds, { padding: 48, maxZoom: 10, duration: 0 });
}
```

Call it after sources/layers are added on `load`, and after event/handoff source updates when the map is loaded.

- [ ] **Step 5: Run map tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/event-map.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add artifacts/adventure-zone/src/components/routes/event-map.tsx artifacts/adventure-zone/src/components/routes/event-map.test.tsx
git commit -m "fix: fit route map to visible markers"
```

---

### Task 3: Give Signed-Out Users Separate Admin and Manager Entry Points

**Files:**
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx`
- Create or modify: `artifacts/adventure-zone/src/lib/manager-auth-context.test.tsx`

**Interfaces:**
- Produces: public landing links/buttons to `/sign-in` and `/manager/sign-in`.
- Preserves: owner sign-in at `/sign-in`.
- Preserves: manager sign-in at `/manager/sign-in`.
- Manager auth context `signIn(legId, password)` posts to `${root}/manager/auth/login`.

- [ ] **Step 1: Add failing landing-page coverage**

Add or extend an app routing test so the signed-out landing renders:

```tsx
expect(screen.getByRole("link", { name: "Admin / Command Center" }))
  .toHaveAttribute("href", "/sign-in");
expect(screen.getByRole("link", { name: "Manager Portal" }))
  .toHaveAttribute("href", "/manager/sign-in");
```

If the current test harness renders buttons instead of links, assert navigation to those exact paths after click.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerSignInPage.test.tsx src/lib/manager-auth-context.test.tsx
```

Expected: at least the new landing/auth-path coverage fails because the landing only exposes one generic owner `Sign in` action.

- [ ] **Step 3: Replace the single landing action with two explicit choices**

In `Landing()` render:

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

Do not make the manager route depend on owner/admin authentication.

- [ ] **Step 4: Add manager endpoint coverage**

In `manager-auth-context.test.tsx`, mock `global.fetch`, call `signIn("leg-kristy", "secret")`, and assert:

```ts
expect(fetch).toHaveBeenCalledWith(
  expect.stringMatching(/\/api\/manager\/auth\/login$/),
  expect.objectContaining({
    method: "POST",
    body: JSON.stringify({ legId: "leg-kristy", password: "secret" }),
  }),
);
expect(fetch).not.toHaveBeenCalledWith(
  expect.stringMatching(/\/api\/auth\/login$/),
  expect.anything(),
);
```

- [ ] **Step 5: Run sign-in tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/ManagerSignInPage.test.tsx src/lib/manager-auth-context.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add artifacts/adventure-zone/src/App.tsx artifacts/adventure-zone/src/pages/ManagerSignInPage.test.tsx artifacts/adventure-zone/src/lib/manager-auth-context.test.tsx
git commit -m "fix: separate admin and manager sign in"
```

---

### Task 4: Add Server-Side Manager Password Uniqueness Checking

**Files:**
- Modify: `artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.test.ts`

**Interfaces:**
- Consumes: existing `verifyLegManagerPassword(password, hash, salt)`.
- Produces repository method:

```ts
listConfiguredPasswordRecords(): Promise<Array<{
  legId: string;
  passwordHash: string;
  passwordSalt: string;
}>>
```

- Produces route behavior: duplicate candidate password on another leg → HTTP `409`.

- [ ] **Step 1: Add failing duplicate-password tests**

Extend `leg-manager-admin.test.ts` mocks with `listConfiguredPasswordRecords` and `verifyLegManagerPassword`.

Active-other-leg conflict:

```ts
mocks.listConfiguredPasswordRecords.mockResolvedValue([
  { legId: "leg-amy", passwordHash: "hash-amy", passwordSalt: "salt-amy" },
]);
mocks.verifyPassword.mockImplementation(async (_password, hash) => hash === "hash-amy");

const response = await request(app())
  .put("/manager-admin/legs/leg-kristy/access")
  .send({ password: "shared-secret" });

expect(response.status).toBe(409);
expect(response.body.error).toBe(
  "That password is already assigned to another manager. Choose a different password.",
);
expect(response.body).not.toHaveProperty("conflictingLegId");
expect(mocks.setPassword).not.toHaveBeenCalled();
```

Self-match must not conflict:

```ts
mocks.listConfiguredPasswordRecords.mockResolvedValue([
  { legId: "leg-kristy", passwordHash: "hash-self", passwordSalt: "salt-self" },
]);
```

Assert HTTP `200` and `setPassword` called.

Distinct password must return `200`.

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts
```

Expected: FAIL because the route currently hashes/writes immediately without comparing other records.

- [ ] **Step 3: Add repository method that includes archived legs**

Implement:

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

Do not join with `travelLegs` using `archivedAt IS NULL`; the uniqueness list must include archived manager access rows.

- [ ] **Step 4: Add uniqueness check before hashing/writing**

Import the existing verifier:

```ts
import {
  hashLegManagerPassword,
  verifyLegManagerPassword,
} from "@/features/leg-manager/leg-manager-auth";
```

Before `hashLegManagerPassword(...)`:

```ts
const existing = await repo.listConfiguredPasswordRecords();
for (const record of existing) {
  if (record.legId === req.params.legId) continue;
  if (await verifyLegManagerPassword(p.data.password, record.passwordHash, record.passwordSalt)) {
    res.status(409).json({
      error: "That password is already assigned to another manager. Choose a different password.",
    });
    return;
  }
}
```

Only after this loop passes should the new password be hashed and saved.

- [ ] **Step 5: Add archived-password coverage**

The route test does not need a real archived DB row; the repository mock should return a record for another leg that is not present in active login legs. Assert the same `409`. This proves the route checks all configured records, not just active statuses.

- [ ] **Step 6: Add non-disclosure assertion**

For conflict responses:

```ts
expect(JSON.stringify(response.body)).not.toContain("leg-amy");
expect(JSON.stringify(response.body)).not.toContain("hash-amy");
expect(JSON.stringify(response.body)).not.toContain("salt-amy");
expect(JSON.stringify(response.body)).not.toContain("shared-secret");
```

- [ ] **Step 7: Run manager admin tests**

```bash
pnpm --filter @workspace/api-server exec vitest run src/routes/leg-manager-admin.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add artifacts/api-server/src/features/leg-manager/leg-manager-repository.ts artifacts/api-server/src/routes/leg-manager-admin.ts artifacts/api-server/src/routes/leg-manager-admin.test.ts
git commit -m "fix: require unique manager passwords"
```

---

### Task 5: Show Duplicate-Password Errors in the Unified Manager/Leg Card

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/RoutesPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx`
- Modify: `artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx`

**Interfaces:**
- Consumes: `PUT /manager-admin/legs/:legId/access` returning HTTP `409` and `{ error }`.
- Produces: per-card portal error message without clearing normal leg fields.

- [ ] **Step 1: Add failing unified-card conflict test**

Mock `onSetManagerPassword` to reject with:

```ts
Object.assign(
  new Error("That password is already assigned to another manager. Choose a different password."),
  { status: 409 },
)
```

Enter a password and click Change password. Assert:

```tsx
expect(await screen.findByText(
  "That password is already assigned to another manager. Choose a different password."
)).toBeInTheDocument();
expect(screen.getByLabelText("Manager / Leg name")).toHaveValue("Kristy");
```

- [ ] **Step 2: Run and verify failure**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: FAIL if the component currently collapses security errors into the generic travel-leg error state or loses the card-local context.

- [ ] **Step 3: Add per-leg portal error state**

Use:

```ts
const [portalErrors, setPortalErrors] = useState<Record<string, string>>({});
```

When changing a password, clear only that leg's portal error. On failure, store `error.message` for that leg. Render the message inside the matching manager portal subsection.

Do not clear leg name, color, base address, vehicle, MPG, resources, or other legs' passwords/errors.

- [ ] **Step 4: Ensure `RoutesPage` preserves API error text**

`handleSetManagerPassword` must throw the API helper's returned error rather than replacing it with a generic message. If `apiPut` already throws the server `error` body, no additional transformation is needed.

- [ ] **Step 5: Run editor tests**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/routes/travel-leg-editor.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add artifacts/adventure-zone/src/pages/RoutesPage.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.tsx artifacts/adventure-zone/src/components/routes/travel-leg-editor.test.tsx
git commit -m "fix: show manager password conflicts inline"
```

---

### Task 6: Focused Regression Verification and Delivery

**Files:**
- Modify: `.github/workflows/calendar-route-handoff-ci.yml`
- No other planned production changes unless verification exposes a regression caused by Tasks 1–5.

**Interfaces:**
- Consumes all prior tasks.
- Produces a merge-ready PR against current `main`.

- [ ] **Step 1: Add the new tests to CI**

Keep the existing calendar, handoff, manager/route-map, frontend build, API build, and workspace typecheck steps. Expand the focused frontend test step to include:

```bash
pnpm --filter @workspace/adventure-zone exec vitest run \
  src/components/routes/travel-leg-editor.test.tsx \
  src/components/routes/event-map.test.tsx \
  src/pages/ManagerSignInPage.test.tsx \
  src/lib/manager-auth-context.test.tsx
```

Keep `src/routes/leg-manager-admin.test.ts` in the API focused test step.

- [ ] **Step 2: Run all feature-focused tests**

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
  src/pages/ManagerSignInPage.test.tsx \
  src/lib/manager-auth-context.test.tsx \
  src/features/calendar/month-spans.test.ts
```

Expected: PASS.

- [ ] **Step 3: Build both production apps**

```bash
pnpm --filter @workspace/adventure-zone run build
pnpm --filter @workspace/api-server run build
```

Expected: both exit `0`.

- [ ] **Step 4: Run workspace typecheck**

```bash
pnpm run typecheck
```

Expected: exit `0`, or if unrelated pre-existing errors reappear, no new errors may originate from files touched by this plan.

- [ ] **Step 5: Compare against current `main`**

Confirm the branch is based on the latest `main` before opening the PR. The diff must be limited to:

- map style/error/viewport behavior,
- signed-out authentication choices and manager auth tests,
- manager password uniqueness and inline error handling,
- focused CI updates,
- approved spec/plan docs if included.

Specifically verify there are no deletions/regressions to finance, receipts, trips, handoffs, calendar, booking data, route geocoding, manager IDs, or session security.

- [ ] **Step 6: Open a PR to `main`**

PR summary must explicitly state:

- the route map now uses a real Vite-compatible basemap and auto-fits to visible markers;
- signed-out users can choose Admin / Command Center or Manager Portal directly;
- manager login remains isolated to `/api/manager/auth/login`;
- duplicate manager passwords are rejected server-side, including archived-manager conflicts;
- no plaintext passwords are exposed;
- existing finance, receipts, trips, handoffs, and route geocoding behavior are preserved.
