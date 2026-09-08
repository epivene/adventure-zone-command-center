# Test Suite Foundation Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align local development with CI, eliminate the thirteen deterministic Adventure Zone suite-load failures, and generate an honest inventory of the remaining behavioral failures.

**Architecture:** Standardize the repository on Node 22 and make package-manager enforcement cross-platform. Repair only deterministic dependency, schema, path, and mock setup faults, then run the untouched full suite and transform Vitest JSON into a domain-grouped review artifact instead of weakening product assertions.

**Tech Stack:** Node.js 22, pnpm 10, TypeScript, Vitest 4, React Testing Library, Zod 3

**Spec:** `docs/superpowers/specs/2026-09-07-test-suite-foundation-design.md`

## Global Constraints

- Do not change current visible product behavior merely to satisfy stale assertions.
- Do not skip tests or narrow the Vitest include pattern.
- Keep CI and local development on Node 22.
- Preserve pnpm as the only supported package manager.
- Keep ambiguous navigation, calling, profile, and workspace expectations in the inventory for separate product decisions.

---

### Task 1: Cross-platform Node and package-manager contract

**Files:**
- Create: `.nvmrc`
- Create: `scripts/enforce-pnpm.mjs`
- Create: `scripts/enforce-pnpm.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `process.env.npm_config_user_agent` and the install working directory
- Produces: a zero/nonzero CLI exit contract, a Node 22 repository declaration, and a cross-platform `preinstall` command

- [ ] **Step 1: Write the failing package-manager tests**

Create `scripts/enforce-pnpm.test.ts` with temporary directories and literal outcomes:

```ts
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const script = path.resolve(__dirname, "enforce-pnpm.mjs");

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryWorkspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "adventure-zone-pnpm-"));
  directories.push(directory);
  writeFileSync(path.join(directory, "package-lock.json"), "{}");
  writeFileSync(path.join(directory, "yarn.lock"), "");
  return directory;
}

describe("enforcePnpmInstall", () => {
  it("accepts pnpm and removes conflicting lockfiles", () => {
    const cwd = temporaryWorkspace();
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, npm_config_user_agent: "pnpm/10.33.4 npm/? node/v22.23.2 win32 x64" },
    });
    expect(result.status).toBe(0);
    expect(existsSync(path.join(cwd, "package-lock.json"))).toBe(false);
    expect(existsSync(path.join(cwd, "yarn.lock"))).toBe(false);
  });

  it("rejects non-pnpm installers", () => {
    const cwd = temporaryWorkspace();
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, npm_config_user_agent: "npm/11.0.0 node/v22.23.2 win32 x64" },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Use pnpm instead");
  });
});
```

- [ ] **Step 2: Run the new tests to verify RED**

Run:

```powershell
npx --yes node@22 node_modules/vitest/vitest.mjs run scripts/enforce-pnpm.test.ts
```

Expected: FAIL because `scripts/enforce-pnpm.mjs` does not exist.

- [ ] **Step 3: Implement the cross-platform guard and runtime declaration**

Create `scripts/enforce-pnpm.mjs`:

```js
import { rmSync } from "node:fs";
import path from "node:path";

rmSync(path.join(process.cwd(), "package-lock.json"), { force: true });
rmSync(path.join(process.cwd(), "yarn.lock"), { force: true });
if (!(process.env.npm_config_user_agent ?? "").startsWith("pnpm/")) {
  console.error("Use pnpm instead");
  process.exitCode = 1;
}
```

Change the root `preinstall` script to `node scripts/enforce-pnpm.mjs`, add `"engines": { "node": "22.x" }`, and create `.nvmrc` containing `22`.

- [ ] **Step 4: Verify the guard and normal pnpm install**

Run:

```powershell
npx --yes node@22 node_modules/vitest/vitest.mjs run scripts/enforce-pnpm.test.ts
pnpm install --ignore-scripts
$env:npm_config_user_agent = "pnpm/10.33.4"
npx --yes node@22 scripts/enforce-pnpm.mjs
Remove-Item Env:\npm_config_user_agent
```

Expected: two tests PASS, install completes, and the guard exits 0 under a pnpm user agent.

- [ ] **Step 5: Commit Task 1**

```powershell
git add .nvmrc package.json scripts/enforce-pnpm.mjs scripts/enforce-pnpm.test.ts
git commit -m "Make package setup cross-platform"
```

### Task 2: Restore Windows x64 native build dependencies

**Files:**
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: pnpm optional dependency resolution on Windows x64
- Produces: installed `lightningcss-win32-x64-msvc`, `@tailwindcss/oxide-win32-x64-msvc`, `@rollup/rollup-win32-x64-msvc`, and `@esbuild/win32-x64` packages

- [ ] **Step 1: Reproduce the clean-install dependency gap**

Run:

```powershell
pnpm why lightningcss-win32-x64-msvc
pnpm why @tailwindcss/oxide-win32-x64-msvc
pnpm why @rollup/rollup-win32-x64-msvc
pnpm why @esbuild/win32-x64
```

Expected: the workspace reports no installed Windows x64 packages because each package is overridden to `'-'`.

- [ ] **Step 2: Remove only the Windows x64 exclusions**

Delete these exact override entries from `pnpm-workspace.yaml` while preserving every other platform override:

```yaml
'@tailwindcss/oxide>@tailwindcss/oxide-win32-x64-msvc': '-'
esbuild>@esbuild/win32-x64: '-'
lightningcss>lightningcss-win32-x64-msvc: '-'
rollup>@rollup/rollup-win32-x64-msvc: '-'
```

- [ ] **Step 3: Regenerate dependencies and verify GREEN**

Run with the repository's declared Node 22 runtime:

```powershell
pnpm install --lockfile-only --ignore-scripts
pnpm install --force --ignore-scripts
pnpm why lightningcss-win32-x64-msvc
pnpm --filter @workspace/adventure-zone build
```

Expected: the Windows Lightning CSS dependency is installed and the Adventure Zone production build exits 0 without manually copying a binary.

- [ ] **Step 4: Commit Task 2**

```powershell
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "Restore Windows native build packages"
```

### Task 3: Repair dependency and Zod suite-load failures

**Files:**
- Modify: `artifacts/adventure-zone/package.json`
- Modify: `artifacts/adventure-zone/src/features/packages/package-input.ts`
- Create: `artifacts/adventure-zone/src/features/packages/package-input.test.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Zod 3.25.76 and `@testing-library/user-event` 14.x
- Produces: lowercase canonical UUID parsing through `z.string().uuid()` and resolvable Design Studio interaction tests

- [ ] **Step 1: Write the failing UUID normalization test**

Create `package-input.test.ts` with a complete valid package template and an uppercase UUID:

```ts
import { describe, expect, it } from "vitest";
import { packageTemplateInputSchema } from "./package-input";

describe("packageTemplateInputSchema", () => {
  it("accepts and lowercases canonical UUIDs with the installed Zod version", () => {
    const parsed = packageTemplateInputSchema.parse({
      id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      name: "Midway",
      basePriceCents: 800000,
      normalCapacity: 8,
      temporaryUnavailableQuantity: 0,
      baseAttractionCount: 8,
      minimumAttractionCount: 6,
      maximumAttractionCount: 10,
      baseDurationMinDays: 1,
      baseDurationMaxDays: 3,
      customerDescription: null,
      bookingTalkingPoints: null,
      operationalRequirements: null,
      setupNotes: null,
      knowledgeReviewNote: null,
      active: true,
    });
    expect(parsed.id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });
});
```

- [ ] **Step 2: Verify the schema test is RED**

Run:

```powershell
npx --yes node@22 ..\..\node_modules\vitest\vitest.mjs run --config vitest.config.ts src/features/packages/package-input.test.ts
```

from `artifacts/adventure-zone`. Expected: suite load fails with `TypeError: z.uuid is not a function`.

- [ ] **Step 3: Apply the dependency and schema repair**

Add `"@testing-library/user-event": "^14.6.1"` to Adventure Zone dev dependencies. Replace:

```ts
const canonicalUuid = z.uuid().transform((value) => value.toLowerCase());
```

with:

```ts
const canonicalUuid = z.string().uuid().transform((value) => value.toLowerCase());
```

Run `pnpm install --lockfile-only --ignore-scripts` to update the lockfile.

- [ ] **Step 4: Verify schema and Design Studio suites are GREEN**

Run from the repository root:

```powershell
npx --yes node@22 node_modules/vitest/vitest.mjs run --config artifacts/adventure-zone/vitest.config.ts artifacts/adventure-zone/src/features/packages/package-input.test.ts artifacts/adventure-zone/src/components/design-studio/AssetPickerSheet.test.tsx artifacts/adventure-zone/src/components/design-studio/LayersSheet.test.tsx artifacts/adventure-zone/src/pages/DesignStudioPage.test.tsx
```

Expected: all four files load and their tests execute without missing-module or Zod errors.

- [ ] **Step 5: Commit Task 3**

```powershell
git add artifacts/adventure-zone/package.json artifacts/adventure-zone/src/features/packages/package-input.ts artifacts/adventure-zone/src/features/packages/package-input.test.ts pnpm-lock.yaml
git commit -m "Repair Adventure Zone test dependencies"
```

### Task 4: Make source-inspection tests path-stable

**Files:**
- Modify: `artifacts/adventure-zone/src/mobile-compact-layout.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/AdminCommandPanelPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/research-sources-page.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/today-active-event-labels.test.ts`
- Modify: `artifacts/adventure-zone/src/components/organizations/organization-list-filler.test.tsx`

**Interfaces:**
- Consumes: Vitest's test-file `__dirname`
- Produces: source reads anchored to each test file rather than transformed `import.meta.url` values or process working-directory assumptions

- [ ] **Step 1: Reproduce the five path failures under Node 22**

Run:

```powershell
npx --yes node@22 ..\..\node_modules\vitest\vitest.mjs run --config vitest.config.ts src/mobile-compact-layout.test.ts src/pages/AdminCommandPanelPage.test.tsx src/pages/research-sources-page.test.ts src/pages/today-active-event-labels.test.ts src/components/organizations/organization-list-filler.test.tsx
```

from `artifacts/adventure-zone`. Expected: failures include `The URL must be of scheme file` and `ENOENT` paths containing either `adventure-zone/api-server` or a duplicated `artifacts/adventure-zone` segment.

- [ ] **Step 2: Anchor every read to the test directory**

Use `path.resolve(__dirname, ...)` in the two `import.meta.url` tests. In the two page tests, change API paths from `../../api-server/...` to `../../../api-server/...`. In `organization-list-filler.test.tsx`, resolve these paths relative to its directory:

```ts
const listSource = readSource("organization-list.tsx");
const pageSource = readSource("../../pages/OrganizationsPage.tsx");
const menuSource = readSource("../profiles/profile-actions-menu.tsx");
const fillerActionSource = readSource("../profiles/profile-filler-action.tsx");
```

and implement `readSource` with `path.resolve(__dirname, relativePath)`.

- [ ] **Step 3: Rerun the five suites**

Run the command from Step 1. Expected: all files load; any remaining failed assertion is reported as a behavioral inventory item rather than a path/setup error.

- [ ] **Step 4: Commit Task 4**

```powershell
git add artifacts/adventure-zone/src/mobile-compact-layout.test.ts artifacts/adventure-zone/src/pages/AdminCommandPanelPage.test.tsx artifacts/adventure-zone/src/pages/research-sources-page.test.ts artifacts/adventure-zone/src/pages/today-active-event-labels.test.ts artifacts/adventure-zone/src/components/organizations/organization-list-filler.test.tsx
git commit -m "Make source inspection tests path-stable"
```

### Task 5: Repair the Google review mock-hoisting failure

**Files:**
- Modify: `artifacts/adventure-zone/src/components/google-workspace/google-validation-review-create-profile.test.tsx`

**Interfaces:**
- Consumes: Vitest's `vi.hoisted()` API
- Produces: a mock function initialized before hoisted `vi.mock()` factories execute

- [ ] **Step 1: Reproduce the hoisting failure**

Run:

```powershell
npx --yes node@22 ..\..\node_modules\vitest\vitest.mjs run --config vitest.config.ts src/components/google-workspace/google-validation-review-create-profile.test.tsx
```

from `artifacts/adventure-zone`. Expected: FAIL with `Cannot access 'createFromReview' before initialization`.

- [ ] **Step 2: Hoist the test double explicitly**

Replace the top-level mock declaration with:

```ts
const { createFromReview } = vi.hoisted(() => ({
  createFromReview: vi.fn(async () => ({ id: "profile-1", name: "Town of Langford" })),
}));
```

Keep the real `GoogleValidationReview` component and its observable create-and-resolve behavior under test.

- [ ] **Step 3: Rerun the focused suite**

Run the command from Step 1. Expected: the test executes without a module-mocking error and passes its existing UI behavior assertion.

- [ ] **Step 4: Commit Task 5**

```powershell
git add artifacts/adventure-zone/src/components/google-workspace/google-validation-review-create-profile.test.tsx
git commit -m "Fix Google review test mock initialization"
```

### Task 6: Generate a domain-grouped failure inventory

**Files:**
- Create: `scripts/report-adventure-zone-test-failures.ts`
- Create: `scripts/report-adventure-zone-test-failures.test.ts`
- Modify: `scripts/package.json`
- Create: `docs/superpowers/reviews/2026-09-07-adventure-zone-test-failure-inventory.json`

**Interfaces:**
- Consumes: Vitest JSON output with `numFailedTestSuites`, `numFailedTests`, and `testResults[].assertionResults[]`
- Produces: `buildFailureInventory(report, runtime)` and a deterministic JSON report grouped by the first two path segments below `src/`

- [ ] **Step 1: Write the failing inventory transformation test**

Use a literal two-file Vitest fixture and assert this output shape:

```ts
expect(buildFailureInventory(report, { node: "v22.23.2", platform: "win32" })).toEqual({
  runtime: { node: "v22.23.2", platform: "win32" },
  totals: { failedFiles: 2, failedTests: 2 },
  groups: [
    { domain: "components/calls", failedFiles: 1, failedTests: 1, files: ["src/components/calls/call-workspace.test.tsx"] },
    { domain: "pages", failedFiles: 1, failedTests: 1, files: ["src/pages/TodayPage.test.tsx"] },
  ],
});
```

The fixture must use absolute Windows-style `name` fields so the test proves path normalization independently of the implementation.

- [ ] **Step 2: Run the inventory test to verify RED**

Run:

```powershell
npx --yes node@22 node_modules/vitest/vitest.mjs run scripts/report-adventure-zone-test-failures.test.ts
```

Expected: FAIL because the report module does not exist.

- [ ] **Step 3: Implement the pure transformer and CLI**

Implement `buildFailureInventory` to normalize `\\` to `/`, retain the suffix beginning at `src/`, group component and feature files as `${segment1}/${segment2}`, group root `pages` files as `pages`, sort files and groups alphabetically, and count only assertion results whose status is `failed`. Add a CLI accepting exact `--input=<path>` and `--output=<path>` arguments, reading Vitest JSON and writing the formatted inventory plus a trailing newline.

Add this script to `scripts/package.json`:

```json
"report:test-failures": "tsx ./report-adventure-zone-test-failures.ts"
```

- [ ] **Step 4: Verify the transformer test is GREEN**

Run the command from Step 2. Expected: PASS with the literal two-group output.

- [ ] **Step 5: Run the complete Node 22 suite and create the inventory**

From `artifacts/adventure-zone`, run:

```powershell
npx --yes node@22 ..\..\node_modules\vitest\vitest.mjs run --config vitest.config.ts --reporter=json --outputFile=..\..\docs\superpowers\reviews\adventure-zone-vitest-raw.json
```

The suite is expected to remain nonzero because behavioral failures are deliberately not weakened. Then from the repository root run:

```powershell
pnpm --filter @workspace/scripts run report:test-failures -- --input=docs/superpowers/reviews/adventure-zone-vitest-raw.json --output=docs/superpowers/reviews/2026-09-07-adventure-zone-test-failure-inventory.json
```

Verify that the JSON totals match Vitest's terminal totals, then remove only the exact temporary file:

```powershell
Remove-Item -LiteralPath 'docs/superpowers/reviews/adventure-zone-vitest-raw.json'
```

- [ ] **Step 6: Commit Task 6**

```powershell
git add scripts/package.json scripts/report-adventure-zone-test-failures.ts scripts/report-adventure-zone-test-failures.test.ts docs/superpowers/reviews/2026-09-07-adventure-zone-test-failure-inventory.json
git commit -m "Inventory remaining Adventure Zone test failures"
```

### Task 7: Foundation verification and handoff

**Files:**
- Modify: `docs/superpowers/reviews/2026-09-07-adventure-zone-test-failure-inventory.json` only if the final rerun changes its verified totals

**Interfaces:**
- Consumes: all preceding task outputs
- Produces: a reviewable foundation branch with no suite-load errors and an exact remaining-failure baseline

- [ ] **Step 1: Run foundation-focused tests**

Run:

```powershell
npx --yes node@22 node_modules/vitest/vitest.mjs run scripts/enforce-pnpm.test.ts scripts/report-adventure-zone-test-failures.test.ts
npx --yes node@22 node_modules/vitest/vitest.mjs run --config artifacts/adventure-zone/vitest.config.ts artifacts/adventure-zone/src/features/packages/package-input.test.ts artifacts/adventure-zone/src/components/design-studio/AssetPickerSheet.test.tsx artifacts/adventure-zone/src/components/design-studio/LayersSheet.test.tsx artifacts/adventure-zone/src/pages/DesignStudioPage.test.tsx artifacts/adventure-zone/src/mobile-compact-layout.test.ts artifacts/adventure-zone/src/pages/AdminCommandPanelPage.test.tsx artifacts/adventure-zone/src/pages/research-sources-page.test.ts artifacts/adventure-zone/src/pages/today-active-event-labels.test.ts artifacts/adventure-zone/src/components/organizations/organization-list-filler.test.tsx artifacts/adventure-zone/src/components/google-workspace/google-validation-review-create-profile.test.tsx
```

Expected: no module-load, Zod API, transformed file-URL, missing-file, or mock-hoisting errors. Behavioral assertion failures, if any, must match entries in the generated inventory.

- [ ] **Step 2: Recheck the shipped document-review behavior and production build**

Run:

```powershell
pnpm --filter @workspace/adventure-zone test -- src/components/business-documents/document-review-queue.test.tsx
pnpm --filter @workspace/adventure-zone build
git diff --check origin/main...HEAD
```

Expected: five document-review tests PASS, the production build exits 0, and the diff check reports no whitespace errors.

- [ ] **Step 3: Review the inventory into follow-up slices**

Read the generated groups and create one recommendation per group using only these classifications:

```text
confirmed_regression
stale_expectation
needs_product_decision
```

Do not change source or tests during this step. Report the highest-count groups and the Release Safety API fixture errors as separate follow-up candidates.

- [ ] **Step 4: Commit any refreshed inventory**

```powershell
git add docs/superpowers/reviews/2026-09-07-adventure-zone-test-failure-inventory.json
git diff --cached --quiet; if ($LASTEXITCODE -ne 0) { git commit -m "Refresh test failure inventory" }
```

- [ ] **Step 5: Prepare the foundation pull request**

Push `chore/test-suite-foundation` and create a PR that reports the exact before/after suite totals, confirms all thirteen suite-load failures now execute, lists the focused verification commands, and links the inventory artifact. Do not claim the full suite is green unless its exit code is zero.
