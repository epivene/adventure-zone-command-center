# Convention QR Welcome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a branded convention welcome only for homepage visits using `?welcome=convention`, guide those visitors to the existing inquiry form, and preserve convention attribution in the Command Center.

**Architecture:** Extend the existing `adventure-zone-site` custom element with a self-contained modal rendered inside its shadow root. The custom element reads the exact `welcome=convention` query parameter, owns modal focus/scroll behavior, and appends a non-visible `Lead source: Convention QR` marker to the existing inquiry message payload; the server contract and CRM schema remain unchanged.

**Tech Stack:** Vanilla JavaScript custom element, Shadow DOM, CSS, Vitest, JSDOM, Wix custom-element hosting, Render static hosting.

**Spec:** `docs/superpowers/specs/2026-09-04-convention-qr-welcome-design.md`

## Global Constraints

- The entry URL is exactly `https://www.the-adventure-zone.com/?welcome=convention`.
- The modal appears only when the `welcome` query parameter is exactly `convention`.
- Do not publish `12%`, a deadline, guaranteed eligibility, or stacking language.
- The ordinary homepage must remain unchanged.
- Reuse the existing inquiry endpoint; do not add a database migration or a new CRM subsystem.
- Convention attribution must not prevent a valid inquiry from being submitted.
- Do not change the mascot, packages, crew bubbles, or unrelated sections.
- Preserve the approval gates for pushing/deploying, editing Wix, publishing Wix, and sending a production inquiry.

## File Structure

- Modify `artifacts/adventure-zone/public/adventure-zone-site.js`: add modal markup, responsive styles, query detection, modal lifecycle, focus handling, CTA scrolling, and inquiry attribution.
- Modify `artifacts/adventure-zone/src/website-custom-element/adventure-zone-site.contract.test.ts`: add contract tests for trigger isolation, copy, accessibility, close behavior, scroll behavior, reduced motion, CTA navigation, and attributed payloads.
- Create `artifacts/adventure-zone/public/adventure-zone-site-20260904-convention-welcome-v29.js`: immutable release copy used to update the Wix Server URL without stale-cache ambiguity.

---

### Task 1: Convention-only modal and interaction contract

**Files:**
- Modify: `artifacts/adventure-zone/src/website-custom-element/adventure-zone-site.contract.test.ts`
- Modify: `artifacts/adventure-zone/public/adventure-zone-site.js`

**Interfaces:**
- Consumes: `window.location.search`, existing `scrollToId(id)`, existing `AbortController` listener lifecycle.
- Produces: `isConventionVisit(): boolean`, `openConventionWelcome(): void`, `closeConventionWelcome(options?: { scrollToContact?: boolean }): void`, and shadow-root markup identified by `.convention-welcome`.

- [ ] **Step 1: Add failing visibility and copy tests**

Add tests that set the URL before mounting and assert exact trigger isolation and approved copy:

```ts
it("shows the approved welcome only for the exact convention query", () => {
  window.history.replaceState({}, "", "/?welcome=convention");
  const { root } = mountSite();
  const dialog = root.querySelector<HTMLElement>(".convention-welcome");

  expect(dialog).not.toHaveAttribute("hidden");
  expect(dialog).toHaveAttribute("role", "dialog");
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(dialog).toHaveTextContent("CONVENTION EXCLUSIVE");
  expect(dialog).toHaveTextContent("Welcome, Convention Guests!");
  expect(dialog).toHaveTextContent("Convention attendees may qualify for exclusive booking savings.");
  expect(dialog?.textContent).not.toMatch(/12%|7 days|15 days/i);
});

it.each(["/", "/?welcome=Convention", "/?welcome=conventions", "/?section=contact"])(
  "does not show the convention welcome for %s",
  (url) => {
    window.history.replaceState({}, "", url);
    const { root } = mountSite();
    expect(root.querySelector(".convention-welcome")).toHaveAttribute("hidden");
  },
);
```

- [ ] **Step 2: Add failing interaction and accessibility tests**

Cover the primary action, secondary action, close button, backdrop, Escape, initial focus, focus wrapping, and scroll lock:

```ts
it("closes the welcome and scrolls to Contact from the primary action", () => {
  window.history.replaceState({}, "", "/?welcome=convention");
  const { root } = mountSite();
  const contact = root.querySelector<HTMLElement>("#contact")!;
  const scrollIntoView = vi.fn();
  contact.scrollIntoView = scrollIntoView;

  root.querySelector<HTMLButtonElement>("[data-convention-claim]")!.click();

  expect(root.querySelector(".convention-welcome")).toHaveAttribute("hidden");
  expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
});

it("locks background scroll and restores it when dismissed", () => {
  window.history.replaceState({}, "", "/?welcome=convention");
  const { root } = mountSite();
  expect(document.body.style.overflow).toBe("hidden");
  root.querySelector<HTMLButtonElement>("[data-convention-explore]")!.click();
  expect(document.body.style.overflow).toBe("");
});
```

Add separate assertions that Escape and backdrop clicks close without scrolling, the close button has `aria-label="Close convention welcome"`, initial focus lands on the primary action, and Tab/Shift+Tab stay inside the dialog.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
pnpm --filter @workspace/adventure-zone exec vitest run src/website-custom-element/adventure-zone-site.contract.test.ts
```

Expected: the new tests fail because `.convention-welcome` and its behavior do not exist.

- [ ] **Step 4: Add modal markup and responsive styles**

Add a `conventionWelcomeMarkup()` helper and include it at the end of `.az-site`, before the closing wrapper:

```js
function conventionWelcomeMarkup() {
  return `<div class="convention-welcome" hidden>
    <button class="convention-backdrop" type="button" data-convention-backdrop aria-label="Close convention welcome"></button>
    <section class="convention-dialog" role="dialog" aria-modal="true" aria-labelledby="convention-welcome-title">
      <button class="convention-close" type="button" data-convention-close aria-label="Close convention welcome">${icon("close")}</button>
      <div class="tag">CONVENTION EXCLUSIVE</div>
      <h2 class="display" id="convention-welcome-title">Welcome, Convention Guests!</h2>
      <p>Thanks for stopping by The Adventure Zone. We bring a fully staffed traveling inflatable carnival to fairs, festivals, rodeos, and major community events.</p>
      <p class="convention-offer">Convention attendees may qualify for exclusive booking savings. Tell us about your event to receive your convention offer.</p>
      <div class="convention-actions">
        <button class="button" type="button" data-convention-claim>Claim Your Convention Offer</button>
        <button class="button outline" type="button" data-convention-explore>Explore the Site</button>
      </div>
    </section>
  </div>`;
}
```

Add fixed, full-viewport modal styles with a centered `min(560px, calc(100vw - 32px))` dialog, `max-height: calc(100dvh - 32px)`, internal vertical scrolling, no horizontal overflow, touch-sized buttons, and a single-column action layout below 480px. Add a short opacity/scale entrance and suppress it inside the existing `prefers-reduced-motion: reduce` block.

- [ ] **Step 5: Implement query detection and modal lifecycle**

Initialize `this.conventionOpen = false` and `this.previousBodyOverflow = ""` in the constructor. In `connectedCallback()`, call `openConventionWelcome()` after `bindInteractions()` when `isConventionVisit()` is true.

```js
isConventionVisit() {
  return new URLSearchParams(window.location.search).get("welcome") === "convention";
}

openConventionWelcome() {
  const welcome = this.shadowRoot.querySelector(".convention-welcome");
  if (!welcome || this.conventionOpen) return;
  this.conventionOpen = true;
  this.previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  welcome.hidden = false;
  window.requestAnimationFrame(() => {
    welcome.classList.add("open");
    welcome.querySelector("[data-convention-claim]")?.focus();
  });
}

closeConventionWelcome({ scrollToContact = false } = {}) {
  const welcome = this.shadowRoot.querySelector(".convention-welcome");
  if (!welcome || !this.conventionOpen) return;
  this.conventionOpen = false;
  welcome.classList.remove("open");
  welcome.hidden = true;
  document.body.style.overflow = this.previousBodyOverflow;
  if (scrollToContact) this.scrollToId("contact");
}
```

Bind click handlers for claim, explore, close, and backdrop. Bind a shadow-root keydown handler that closes on Escape and cycles focus between the dialog's enabled buttons on Tab/Shift+Tab. In `disconnectedCallback()`, restore `document.body.style.overflow` when the modal is open.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
pnpm --filter @workspace/adventure-zone exec vitest run src/website-custom-element/adventure-zone-site.contract.test.ts
```

Expected: all custom-element contract tests pass.

- [ ] **Step 7: Commit the modal**

```powershell
git add artifacts/adventure-zone/public/adventure-zone-site.js artifacts/adventure-zone/src/website-custom-element/adventure-zone-site.contract.test.ts
git commit -m "feat: add convention QR welcome"
```

---

### Task 2: Convention lead attribution without a server migration

**Files:**
- Modify: `artifacts/adventure-zone/src/website-custom-element/adventure-zone-site.contract.test.ts`
- Modify: `artifacts/adventure-zone/public/adventure-zone-site.js`

**Interfaces:**
- Consumes: `isConventionVisit(): boolean` from Task 1 and the existing `collectFormValues(form)` / `submitInquiry(event)` flow.
- Produces: `withInquiryAttribution(values): object`, which returns a copy and never changes ordinary inquiries.

- [ ] **Step 1: Add failing payload attribution tests**

Add one convention and one ordinary submission assertion:

```ts
it("marks a convention QR inquiry in the existing message payload", async () => {
  window.history.replaceState({}, "", "/?welcome=convention");
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ referenceCode: "AZI-CONVENTION", message: "Saved." }), { status: 201 }));
  const { form } = mountForm();

  submit(form);
  await flush();

  const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]![1]!.body));
  expect(body.message).toBe("Please bring the full Adventure Zone.\n\nLead source: Convention QR");
  expect(body.pageUrl).toContain("welcome=convention");
});

it("does not alter the message for an ordinary inquiry", async () => {
  globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ referenceCode: "AZI-ORDINARY", message: "Saved." }), { status: 201 }));
  const { form } = mountForm();
  submit(form);
  await flush();
  const body = JSON.parse(String(vi.mocked(globalThis.fetch).mock.calls[0]![1]!.body));
  expect(body.message).toBe("Please bring the full Adventure Zone.");
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run the same focused Vitest command. Expected: the convention message lacks `Lead source: Convention QR`.

- [ ] **Step 3: Add minimal attribution at payload construction**

Add:

```js
withInquiryAttribution(values) {
  if (!this.isConventionVisit()) return values;
  return {
    ...values,
    message: `${values.message}\n\nLead source: Convention QR`,
  };
}
```

In `submitInquiry()`, replace `const values = this.collectFormValues(form);` with:

```js
const values = this.withInquiryAttribution(this.collectFormValues(form));
```

The form's visible textarea remains untouched. The existing public contract accepts the resulting message because the form limit plus marker remains below the server's 5,000-character maximum.

- [ ] **Step 4: Run inquiry and custom-element tests**

```powershell
pnpm --filter @workspace/adventure-zone exec vitest run src/website-custom-element/adventure-zone-site.contract.test.ts src/features/website-inquiries
```

Expected: all tests pass and ordinary inquiry payloads remain byte-for-byte unchanged apart from their existing generated IDs and URLs.

- [ ] **Step 5: Commit attribution**

```powershell
git add artifacts/adventure-zone/public/adventure-zone-site.js artifacts/adventure-zone/src/website-custom-element/adventure-zone-site.contract.test.ts
git commit -m "feat: attribute convention QR inquiries"
```

---

### Task 3: Release asset, regression verification, and controlled rollout

**Files:**
- Create: `artifacts/adventure-zone/public/adventure-zone-site-20260904-convention-welcome-v29.js`

**Interfaces:**
- Consumes: the tested canonical `adventure-zone-site.js` from Tasks 1 and 2.
- Produces: immutable hosted URL `https://adventure-zone-command-center-1.onrender.com/adventure-zone-site-20260904-convention-welcome-v29.js` for Wix.

- [ ] **Step 1: Create and verify the immutable release copy**

```powershell
Copy-Item -LiteralPath artifacts/adventure-zone/public/adventure-zone-site.js -Destination artifacts/adventure-zone/public/adventure-zone-site-20260904-convention-welcome-v29.js
$canonical = (Get-FileHash artifacts/adventure-zone/public/adventure-zone-site.js -Algorithm SHA256).Hash
$release = (Get-FileHash artifacts/adventure-zone/public/adventure-zone-site-20260904-convention-welcome-v29.js -Algorithm SHA256).Hash
if ($canonical -ne $release) { throw 'Release copy does not match the canonical script.' }
```

- [ ] **Step 2: Run the full proportional verification**

```powershell
pnpm --filter @workspace/adventure-zone exec vitest run src/website-custom-element/adventure-zone-site.contract.test.ts src/features/website-inquiries
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
git diff --check
```

Expected: all tests and type checks pass, the build completes, and `git diff --check` prints nothing.

- [ ] **Step 3: Commit the release asset**

```powershell
git add artifacts/adventure-zone/public/adventure-zone-site-20260904-convention-welcome-v29.js
git commit -m "build: add convention welcome release asset"
```

- [ ] **Step 4: Stop for push and Render deployment approval**

Report the test results and exact commits. Obtain explicit approval before pushing. After approval, push the current branch and wait for the Render static host deployment to finish.

- [ ] **Step 5: Verify the hosted script read-only**

```powershell
$script = Invoke-WebRequest -UseBasicParsing 'https://adventure-zone-command-center-1.onrender.com/adventure-zone-site-20260904-convention-welcome-v29.js'
$script.StatusCode
$script.Headers.'Content-Type'
$script.Content.Contains('Welcome, Convention Guests!')
$script.Content.Contains('Lead source: Convention QR')
```

Expected: HTTP 200, JavaScript content type, and both content checks return `True`.

- [ ] **Step 6: Stop for Wix edit approval**

Obtain explicit approval, then update the existing Wix custom element's Server URL to:

```text
https://adventure-zone-command-center-1.onrender.com/adventure-zone-site-20260904-convention-welcome-v29.js
```

Keep the tag name `adventure-zone-site`. Save the draft without publishing.

- [ ] **Step 7: Preview both entry paths without submitting**

Verify the ordinary homepage in desktop and mobile Preview has no convention modal. Verify the convention URL in a browser at desktop width and narrow/folding-screen widths. Confirm copy, close controls, focus behavior, CTA scrolling, no horizontal overflow, and unchanged mascot/packages/team layout. Do not submit the form.

- [ ] **Step 8: Stop for Wix publish approval**

After Preview passes, obtain explicit approval and publish the Wix draft.

- [ ] **Step 9: Verify production without sending an inquiry**

Open both:

```text
https://www.the-adventure-zone.com/
https://www.the-adventure-zone.com/?welcome=convention
```

Confirm the ordinary URL has no modal and the convention URL does. Confirm `CLAIM YOUR CONVENTION OFFER` reaches Contact. Do not submit the inquiry form.

- [ ] **Step 10: Stop for production inquiry approval**

If the user approves a smoke inquiry, submit exactly one clearly labeled convention QR test. Confirm it appears in Website Inquiries with `Lead source: Convention QR`, retains duplicate/profile-match suggestions, and does not automatically create CRM records. Archive the smoke inquiry; do not convert it.

- [ ] **Step 11: Hand off the QR destination**

Provide Dave with the exact destination:

```text
https://www.the-adventure-zone.com/?welcome=convention
```

Confirm the new destination in a browser before the physical QR code is used. If the QR service is dynamic, update its destination there; if it is static, generate and print a replacement QR code.

