# Open Documents In Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a secure file-opening control to each Business Documents review card without changing the review's state.

**Architecture:** Extend `DocumentReviewQueue` with per-document opening state and a small handler that reuses `businessDocumentsApi.open(documentId)`. Render the control alongside existing review actions and surface failures through the component's existing inline alert.

**Tech Stack:** React, TypeScript, Vitest, Testing Library

**Spec:** `docs/superpowers/specs/2026-09-07-open-documents-in-review-design.md`

## Global Constraints

- Reuse the existing protected-document open endpoint; do not add an API or database change.
- Opening must not remove or mutate the pending review item.
- Open the returned short-lived URL in a new tab with `noopener,noreferrer`.

---

### Task 1: Open protected files from review cards

**Files:**
- Modify: `artifacts/adventure-zone/src/components/business-documents/document-review-queue.tsx`
- Test: `artifacts/adventure-zone/src/components/business-documents/document-review-queue.test.tsx`

**Interfaces:**
- Consumes: `businessDocumentsApi.open(documentId: string): Promise<string>` and `BusinessDocumentReviewItem.documentId`
- Produces: an accessible `Open protected file for ${displayName}` button and inline open-failure feedback

- [ ] **Step 1: Write the failing success-path test**

Add an `open` API mock and a `window.open` spy. Render the real review queue, click `Open protected file for County Fair COI`, and assert the observable browser side effect:

```tsx
fireEvent.click(await screen.findByRole("button", { name: "Open protected file for County Fair COI" }));
await waitFor(() => expect(openWindow).toHaveBeenCalledWith(
  "https://files.example.test/doc-1",
  "_blank",
  "noopener,noreferrer",
));
expect(screen.getByText("County Fair COI")).toBeVisible();
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```powershell
pnpm --filter @workspace/adventure-zone test -- src/components/business-documents/document-review-queue.test.tsx
```

Expected: FAIL because the review card has no accessible open-file button.

- [ ] **Step 3: Implement the success path**

Add `openingId` state, call `businessDocumentsApi.open(item.documentId)`, and pass the returned URL to:

```tsx
window.open(url, "_blank", "noopener,noreferrer");
```

Render an outline button whose accessible name includes the review display name. Disable and relabel only the actively opening button.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run the command from Step 2. Expected: all tests in the file PASS.

- [ ] **Step 5: Write the failing error-path test**

Make `businessDocumentsApi.open` reject, click the button, and assert that the real review card stays visible and the alert says `That protected file is not available right now.`

- [ ] **Step 6: Run the focused test to verify RED**

Run the command from Step 2. Expected: FAIL because an open error is not yet converted to inline feedback.

- [ ] **Step 7: Implement failure handling**

Catch the rejected open request, set the existing inline error state to `That protected file is not available right now.`, and clear `openingId` in `finally`.

- [ ] **Step 8: Run tests and build**

Run:

```powershell
pnpm --filter @workspace/adventure-zone test -- src/components/business-documents/document-review-queue.test.tsx
pnpm --filter @workspace/adventure-zone build
```

Expected: focused tests PASS and the production build succeeds.

- [ ] **Step 9: Commit**

```powershell
git add docs/superpowers/specs/2026-09-07-open-documents-in-review-design.md docs/superpowers/plans/2026-09-07-open-documents-in-review.md artifacts/adventure-zone/src/components/business-documents/document-review-queue.tsx artifacts/adventure-zone/src/components/business-documents/document-review-queue.test.tsx
git commit -m "Add protected file opening to document review"
```
