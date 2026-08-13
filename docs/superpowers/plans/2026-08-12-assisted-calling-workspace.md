# Assisted Calling Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Five9-style assisted calling workflow that combines the Today queue, caller context, simple call/voicemail actions, caller matching, notes, outcomes, and follow-up scheduling while Phone Link continues to carry the actual calls.

**Architecture:** Extend the existing call service, call workspace, Today query, and quick-caller flow instead of creating a parallel subsystem. Add a normalized one-to-many contact phone model with legacy-primary compatibility, a bounded caller-finder service, and shared responsive React components used by Today, contact/event profiles, the standalone workspace, and mobile call logging. Keep telephony behind browser launch/copy adapters and server-provided configuration so a future provider can replace Phone Link without changing CRM behavior.

**Tech Stack:** TypeScript 5.9, React 19, Vite, Wouter, Express 5, PostgreSQL, Drizzle ORM, Zod 4, Tailwind CSS, Vitest 4, Testing Library, Supertest, pnpm workspace.

## Global Constraints

- Daily UI copy must use **Call**, **Call office**, **Leave voicemail**, **Use extension**, and **Copy number**; do not expose an external voicemail vendor name.
- The first version supports individually initiated, personally recorded voicemail only; no bulk campaigns or prerecorded-message uploads.
- Phone Link and the external voicemail service are launch targets only; never claim they are connected or that a call/voicemail was delivered.
- Only one exact normalized phone match may auto-open; area code, location, route, history, notes, and other weak signals always require a user click.
- Preserve existing call history, follow-up behavior, ACT import compatibility, idempotent request keys, and organization-level Last Resort behavior.
- A phone-number-level Do Not Call decision suppresses future call and voicemail actions but does not automatically move the organization to Last Resort.
- Do not add recording, transcription, AI summaries, automatic incoming screen-pop, carrier lookup, or a permanent phone provider.
- The feature ships behind server environment variable `ASSISTED_CALLING_ENABLED=true`; voicemail launching is optionally configured with `VOICEMAIL_LAUNCH_URL`.
- New tracked database changes must be added to `lib/db/migrations` and registered in `lib/db/src/migrations.ts`.

## File map

### Database and shared persistence

- `lib/db/src/schema/index.ts` — contact phone table, call metadata columns, and new call dispositions.
- `lib/db/migrations/020_assisted_calling.sql` — additive schema migration, phone backfill, constraints, and indexes.
- `lib/db/migrations/021_call_session_metadata.sql` — additive call direction/method/snapshot/script columns and dispositions.
- `lib/db/src/migrations.ts` — register migration 020.

### API server

- `artifacts/api-server/src/features/contact-phones/contact-phone-types.ts` — canonical phone types and DTOs.
- `artifacts/api-server/src/features/contact-phones/contact-phone-repository.ts` — list/write/primary compatibility and Do Not Call persistence.
- `artifacts/api-server/src/features/contact-phones/contact-phone-repository.test.ts` — phone behavior and legacy mirroring tests.
- `artifacts/api-server/src/features/calls/call-input.ts` — validate direction, method, selected number, script kind, and new outcomes.
- `artifacts/api-server/src/features/calls/call-types.ts` — shared call contract additions.
- `artifacts/api-server/src/features/calls/call-repository.ts` — persist immutable phone snapshots and call metadata.
- `artifacts/api-server/src/features/calls/call-service.ts` — wrong-number and number-level Do Not Call rules.
- `artifacts/api-server/src/features/calls/call-service.test.ts` — idempotency, metadata, Do Not Call, and follow-up tests.
- `artifacts/api-server/src/features/calls/call-workspace-context.ts` — phones, route leg, booking status, and last-contacted context.
- `artifacts/api-server/src/features/calls/call-workspace-query.ts` — assemble enriched workspace payload.
- `artifacts/api-server/src/features/calls/call-workspace-query.test.ts` — enriched workspace payload tests.
- `artifacts/api-server/src/features/calls/call-script.ts` — deterministic default script selection and prompt content.
- `artifacts/api-server/src/features/calls/call-script.test.ts` — script-selection tests.
- `artifacts/api-server/src/features/caller-finder/caller-finder-types.ts` — bounded query/result/match-reason types.
- `artifacts/api-server/src/features/caller-finder/caller-finder-service.ts` — ranking, exact-match behavior, area-code hints, and live narrowing.
- `artifacts/api-server/src/features/caller-finder/caller-finder-service.test.ts` — ranking and safety tests.
- `artifacts/api-server/src/features/contacts/quick-caller-service.ts` — duplicate-candidate gate before quick creation.
- `artifacts/api-server/src/features/contacts/quick-caller-service.test.ts` — exact and likely-duplicate tests.
- `artifacts/api-server/src/features/follow-ups/today-query.ts` — expose the call queue and fields required by the inline workspace.
- `artifacts/api-server/src/routes/calls.ts` — workspace, completion, caller-finder, and config endpoints.
- `artifacts/api-server/src/routes/contacts.ts` — contact phone CRUD routes.
- `artifacts/api-server/src/routes/today.ts` — return the enriched queue.
- `artifacts/api-server/src/routes/calls.test.ts` — HTTP contract and feature-flag tests.

### Web application

- `artifacts/adventure-zone/src/features/contact-phones/contact-phone-types.ts` — web copy of the phone DTO contract.
- `artifacts/adventure-zone/src/features/calls/call-types.ts` — web copy of the enriched call contract.
- `artifacts/adventure-zone/src/features/calls/call-scripts.ts` — script labels and prompts rendered by the workspace.
- `artifacts/adventure-zone/src/features/calls/call-draft.ts` — seven-day local draft store.
- `artifacts/adventure-zone/src/features/calls/call-draft.test.ts` — draft expiry/restore/clear tests.
- `artifacts/adventure-zone/src/features/calls/phone-launcher.ts` — `tel:`/clipboard/external-voicemail behavior without delivery claims.
- `artifacts/adventure-zone/src/features/calls/phone-launcher.test.ts` — URL and fallback tests.
- `artifacts/adventure-zone/src/components/calls/phone-actions.tsx` — number selector and simple call action labels.
- `artifacts/adventure-zone/src/components/calls/call-context-row.tsx` — booking status, leg, and last-contacted cards.
- `artifacts/adventure-zone/src/components/calls/call-script-card.tsx` — script selector and prompts.
- `artifacts/adventure-zone/src/components/calls/call-workspace.tsx` — shared compact/full/mobile workspace composition.
- `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx` — shared workspace interaction tests.
- `artifacts/adventure-zone/src/components/calls/caller-finder.tsx` — incoming caller search, possible matches, and match reasons.
- `artifacts/adventure-zone/src/components/calls/caller-finder.test.tsx` — exact/possible/no-match behavior.
- `artifacts/adventure-zone/src/components/contacts/quick-add-caller.test.tsx` — exact conflict and likely-duplicate bypass tests.
- `artifacts/adventure-zone/src/components/today/call-queue-workspace.tsx` — desktop split and mobile stacked Today composition.
- `artifacts/adventure-zone/src/components/today/call-queue-workspace.test.tsx` — queue selection and responsive behavior.
- `artifacts/adventure-zone/src/pages/TodayPage.tsx` — replace the old Next Call arrangement when enabled.
- `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx` — keep the standalone fallback using the shared component.
- `artifacts/adventure-zone/src/pages/MobileCallLogPage.tsx` — quick incoming/outgoing mobile log entry.
- `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx` — phone list and call/log actions.
- `artifacts/adventure-zone/src/pages/ContactDetailPage.test.tsx` — contact call action URL tests.
- `artifacts/adventure-zone/src/pages/EventProfilePage.tsx` — open the same workspace with event context.
- `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx` — event-context call action URL tests.
- `artifacts/adventure-zone/src/components/contacts/contact-form.tsx` — manage multiple labeled numbers and extensions.
- `artifacts/adventure-zone/src/components/contacts/quick-add-caller.tsx` — render likely duplicate choices before explicit creation.
- `artifacts/adventure-zone/src/App.tsx` — add `/calls/log` route.

---

### Task 1: Add the contact phone-number model with legacy compatibility

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/020_assisted_calling.sql`
- Modify: `lib/db/src/migrations.ts`
- Create: `artifacts/api-server/src/features/contact-phones/contact-phone-types.ts`
- Create: `artifacts/api-server/src/features/contact-phones/contact-phone-repository.ts`
- Create: `artifacts/api-server/src/features/contact-phones/contact-phone-repository.test.ts`

**Interfaces:**
- Consumes: existing `contacts.phone`, `contacts.normalizedPhone`, and `normalizeNorthAmericanPhone(value)`.
- Produces: `ContactPhoneType`, `ContactPhoneRecord`, `ContactPhoneInput`, `ContactPhoneRepository.listForContact(contactId)`, `replaceForContact(contactId, inputs, now)`, and `markDoNotCall(phoneId, reason, now)`.

- [ ] **Step 1: Write failing repository tests for backfilled reads and primary mirroring**

```ts
it("returns the primary phone first and mirrors it to the legacy contact", async () => {
  await repository.replaceForContact(contactId, [
    { id: null, number: "701-555-0100", type: "office", extension: "4", label: null, primary: false },
    { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
  ], now);

  expect(await repository.listForContact(contactId)).toMatchObject([
    { normalizedNumber: "+17015550199", type: "mobile", primary: true },
    { normalizedNumber: "+17015550100", type: "office", extension: "4", primary: false },
  ]);
  expect(await loadLegacyContact(contactId)).toMatchObject({
    phone: "701-555-0199",
    normalizedPhone: "+17015550199",
  });
});

it("records Do Not Call on one number without marking the organization Last Resort", async () => {
  await repository.markDoNotCall(phoneId, "Asked not to receive calls", now);
  expect(await repository.listForContact(contactId)).toContainEqual(
    expect.objectContaining({ id: phoneId, doNotCallAt: now }),
  );
  expect(await loadOrganization(organizationId)).toMatchObject({ lastResort: false });
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the phone repository does not exist**

Run: `pnpm --filter @workspace/api-server test -- src/features/contact-phones/contact-phone-repository.test.ts`

Expected: FAIL with an import/module error for `contact-phone-repository`.

- [ ] **Step 3: Add the schema and tracked migration**

Add these schema values and table shape:

```ts
export const contactPhoneTypeValues = ["mobile", "office", "alternate", "unknown"] as const;
export const contactPhoneTypeEnum = pgEnum("contact_phone_type", contactPhoneTypeValues);

export const contactPhones = pgTable("contact_phones", {
  id: uuid("id").defaultRandom().primaryKey(),
  contactId: uuid("contact_id").notNull().references(() => contacts.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  normalizedNumber: text("normalized_number"),
  type: contactPhoneTypeEnum("type").default("unknown").notNull(),
  extension: text("extension"),
  label: text("label"),
  primary: boolean("primary").default(false).notNull(),
  source: text("source").default("local").notNull(),
  doNotCallAt: timestamp("do_not_call_at", { withTimezone: true }),
  doNotCallReason: text("do_not_call_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("contact_phones_one_primary_per_contact").on(table.contactId).where(sql`${table.primary}`),
  index("contact_phones_normalized_number_idx").on(table.normalizedNumber),
  check("contact_phones_number_nonblank", sql`btrim(${table.number}) <> ''`),
]);
```

Migration `020_assisted_calling.sql` must create the enum/table, backfill each nonblank `contacts.phone` as `primary=true`, `type='unknown'`, `source='legacy'`, and use the stored `contacts.normalized_phone`. Register migration ID `020_assisted_calling` after migration 019.

- [ ] **Step 4: Implement transactional replacement and compatibility mirroring**

Use a transaction and lock the contact row. Reject an empty list only when the caller expects to preserve a current number; enforce exactly one primary when inputs are nonempty. Normalize numbers with `normalizeNorthAmericanPhone`, preserve raw display values and extensions separately, reconcile rows by stable ID, delete only omitted rows, insert only rows whose ID is null, and update the legacy fields from the selected primary. Preserve Do Not Call fields during ordinary edits. If a suppressed row's normalized number changes, reject the edit and instruct the caller to add a new number so suppression history is not transferred to a different destination.

```ts
export type ContactPhoneInput = {
  id: string | null;
  number: string;
  type: ContactPhoneType;
  extension: string | null;
  label: string | null;
  primary: boolean;
};

export type ContactPhoneRecord = Omit<ContactPhoneInput, "id"> & {
  id: string;
  contactId: string;
  normalizedNumber: string | null;
  source: string;
  doNotCallAt: Date | null;
  doNotCallReason: string | null;
};
```

- [ ] **Step 5: Run repository tests and the database typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/features/contact-phones/contact-phone-repository.test.ts && pnpm run typecheck:libs`

Expected: PASS.

- [ ] **Step 6: Commit the phone foundation**

```bash
git add lib/db/src/schema/index.ts lib/db/src/migrations.ts lib/db/migrations/020_assisted_calling.sql artifacts/api-server/src/features/contact-phones
git commit -m "feat: add contact phone records"
```

### Task 2: Expose multiple phone numbers in contact APIs and forms

**Files:**
- Modify: `artifacts/api-server/src/features/contacts/contact-input.ts`
- Modify: `artifacts/api-server/src/features/contacts/contact-types.ts`
- Modify: `artifacts/api-server/src/features/contacts/contact-repository.ts`
- Modify: `artifacts/api-server/src/routes/contacts.ts`
- Create: `artifacts/api-server/src/routes/contacts.test.ts`
- Create: `artifacts/adventure-zone/src/features/contact-phones/contact-phone-types.ts`
- Modify: `artifacts/adventure-zone/src/features/contacts/contact-input.ts`
- Modify: `artifacts/adventure-zone/src/features/contacts/contact-types.ts`
- Modify: `artifacts/adventure-zone/src/components/contacts/contact-form.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx`

**Interfaces:**
- Consumes: Task 1 `ContactPhoneInput`, `ContactPhoneRecord`, and repository methods.
- Produces: contact detail JSON field `phones: ContactPhoneRecord[]`; `PUT /contacts/:id/phones`; reusable web `ContactPhoneFields`.

- [ ] **Step 1: Write failing API tests for listing and replacing phone numbers**

```ts
it("returns labeled phones on contact detail", async () => {
  const response = await request(app).get(`/api/contacts/${contactId}`).expect(200);
  expect(response.body.phones).toEqual([
    expect.objectContaining({ type: "mobile", primary: true, number: "701-555-0199" }),
  ]);
});

it("replaces phones and returns validation errors without changing existing rows", async () => {
  await request(app).put(`/api/contacts/${contactId}/phones`).send({
    phones: [
      { id: null, number: "701-555-0100", type: "office", extension: "12", label: null, primary: true },
      { id: null, number: "701-555-0199", type: "mobile", extension: null, label: null, primary: true },
    ],
  }).expect(400);
  expect(await repository.listForContact(contactId)).toHaveLength(1);
});
```

- [ ] **Step 2: Run the contact route test and verify the new contract is missing**

Run: `pnpm --filter @workspace/api-server test -- src/routes/contacts.test.ts`

Expected: FAIL because `phones` and `PUT /contacts/:id/phones` do not exist.

- [ ] **Step 3: Add validated phone input and API routes**

Use the same Zod shape in API and web copies:

```ts
export const contactPhoneInputSchema = z.object({
  id: z.uuid().nullable(),
  number: z.string().trim().min(1),
  type: z.enum(["mobile", "office", "alternate", "unknown"]),
  extension: z.string().trim().max(20).transform(value => value || null),
  label: z.string().trim().max(60).transform(value => value || null),
  primary: z.boolean(),
});

export const replaceContactPhonesSchema = z.object({
  phones: z.array(contactPhoneInputSchema).max(10),
}).superRefine(({ phones }, context) => {
  if (phones.length && phones.filter(phone => phone.primary).length !== 1) {
    context.addIssue({ code: "custom", message: "Choose one primary phone number.", path: ["phones"] });
  }
});
```

Return `phones` from `GET /contacts/:id` and add authenticated `PUT /contacts/:id/phones`. Map validation failures to HTTP 400 and missing contacts to HTTP 404.

- [ ] **Step 4: Render and edit labeled numbers on contact screens**

In `ContactDetailPage`, list each number with its label/type, extension, primary badge, and Do Not Call badge. In `contact-form.tsx`, provide add/remove rows, type selector, primary radio, extension field, and label field. Keep the existing single-phone field populated from the primary number until all old call sites are migrated.

- [ ] **Step 5: Run contact tests and both artifact typechecks**

Run: `pnpm --filter @workspace/api-server test -- src/routes/contacts.test.ts && pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS.

- [ ] **Step 6: Commit contact phone management**

```bash
git add artifacts/api-server/src/features/contacts artifacts/api-server/src/routes/contacts.ts artifacts/api-server/src/routes/contacts.test.ts artifacts/adventure-zone/src/features/contact-phones artifacts/adventure-zone/src/features/contacts artifacts/adventure-zone/src/components/contacts/contact-form.tsx artifacts/adventure-zone/src/pages/ContactDetailPage.tsx
git commit -m "feat: manage labeled contact phones"
```

### Task 3: Persist call direction, method, number snapshots, script kind, and suppression outcomes

**Files:**
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/migrations/021_call_session_metadata.sql`
- Modify: `lib/db/src/migrations.ts`
- Modify: `artifacts/api-server/src/features/calls/call-input.ts`
- Modify: `artifacts/api-server/src/features/calls/call-types.ts`
- Modify: `artifacts/api-server/src/features/calls/call-repository.ts`
- Modify: `artifacts/api-server/src/features/calls/call-service.ts`
- Modify: `artifacts/api-server/src/features/calls/call-service.test.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/call-types.ts`
- Modify: `artifacts/adventure-zone/src/actions/calls.ts`

**Interfaces:**
- Consumes: existing `CompleteCallInput`, Task 1 `contactPhones`, and existing request-key idempotency.
- Produces: `CallDirection`, `CallMethod`, `CallScriptKind`, added `spoke_with_contact`, `wrong_number`, and `do_not_call` dispositions, and immutable call number snapshots.

- [ ] **Step 1: Add failing service tests for metadata and number-level Do Not Call**

```ts
it("persists the selected phone snapshot and call method", async () => {
  const result = await service.complete(validCall({
    direction: "outgoing",
    method: "office_call",
    phoneId,
    scriptKind: "follow_up",
  }));
  expect(result.ok).toBe(true);
  expect(repository.createdSession).toMatchObject({
    direction: "outgoing",
    method: "office_call",
    phoneId,
    phoneNumberSnapshot: "701-555-0100",
    phoneExtensionSnapshot: "12",
    scriptKind: "follow_up",
  });
});

it("marks only the selected number Do Not Call after confirmation", async () => {
  await service.complete(validCall({
    disposition: "do_not_call",
    doNotCallConfirmed: true,
    doNotCallReason: "Requested during call",
    phoneId,
  }));
  expect(repository.suppressedPhoneId).toBe(phoneId);
  expect(repository.updatedOrganization).toBeUndefined();
});
```

- [ ] **Step 2: Run the service test and verify missing fields fail**

Run: `pnpm --filter @workspace/api-server test -- src/features/calls/call-service.test.ts`

Expected: FAIL on the new call metadata and disposition assertions.

- [ ] **Step 3: Add migration 021 and extend the schema additively**

Add nullable `phone_id`, non-null defaults for `direction='outgoing'`, `method='standard_call'`, nullable `phone_number_snapshot`, `phone_extension_snapshot`, and `script_kind`. Extend the call disposition enum using `ALTER TYPE call_disposition ADD VALUE IF NOT EXISTS 'spoke_with_contact'`, `'wrong_number'`, and `'do_not_call'`. Use checks:

```sql
check (direction in ('incoming', 'outgoing'));
check (method in ('standard_call', 'office_call', 'individual_voicemail', 'mobile_log'));
check (script_kind in ('first_outreach', 'follow_up', 'contract_follow_up', 'incoming_inquiry') or script_kind is null);
```

Put these changes in `021_call_session_metadata.sql` and register migration ID `021_call_session_metadata` after migration 020. Do not modify migration 020 after Task 1 has committed it.

- [ ] **Step 4: Extend the public call contract and validation**

```ts
export type CallDirection = "incoming" | "outgoing";
export type CallMethod = "standard_call" | "office_call" | "individual_voicemail" | "mobile_log";
export type CallScriptKind = "first_outreach" | "follow_up" | "contract_follow_up" | "incoming_inquiry";

export type CompleteCallInput = {
  requestKey: string;
  organizationId: string | null;
  contactId: string | null;
  bookingId: string | null;
  followUpId: string | null;
  note: string;
  disposition: CallDisposition;
  resultingBookingStatus: BookingStatus | null;
  startedAt: Date;
  endedAt: Date;
  nextAction: { kind: string; dueAt: Date } | null;
  lastResortReason: string | null;
  lastResortConfirmed: boolean;
  approvedContactUpdates: Partial<ContactFields> | null;
  approvedBookingUpdates: Partial<BookingEditInput> | null;
  direction: CallDirection;
  method: CallMethod;
  phoneId: string | null;
  scriptKind: CallScriptKind;
  doNotCallConfirmed: boolean;
  doNotCallReason: string | null;
};
```

Require `doNotCallConfirmed`, a nonblank `doNotCallReason`, and a valid `phoneId` for `do_not_call`. Validate that a supplied phone belongs to the selected contact. The server, not the browser, loads that row and derives `phoneNumberSnapshot` and `phoneExtensionSnapshot` so historical data cannot be forged or drift from the selected phone. Map the user-facing **Call back later** choice to existing `follow_up_needed`; persist **Spoke with contact**, **Wrong number**, and **Do not call** as the three new dispositions.

- [ ] **Step 5: Persist the snapshot inside the existing idempotent transaction**

Extend the existing call-session insert and replay response. Load the selected phone inside the same transaction, verify ownership, and copy its raw number and extension into the immutable snapshot columns. For `do_not_call`, update only `contact_phones.do_not_call_at/reason`. For `wrong_number`, retain the historical number snapshot and do not suppress automatically. Preserve the existing Last Resort confirmation path separately.

- [ ] **Step 6: Run service tests, migration typecheck, and API typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/features/calls/call-service.test.ts && pnpm run typecheck:libs && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 7: Commit enriched call persistence**

```bash
git add lib/db/src/schema/index.ts lib/db/src/migrations.ts lib/db/migrations/021_call_session_metadata.sql artifacts/api-server/src/features/calls artifacts/adventure-zone/src/features/calls/call-types.ts artifacts/adventure-zone/src/actions/calls.ts
git commit -m "feat: record assisted call metadata"
```

### Task 4: Enrich workspace context and select flexible scripts

**Files:**
- Modify: `artifacts/api-server/src/features/calls/call-workspace-context.ts`
- Modify: `artifacts/api-server/src/features/calls/call-workspace-query.ts`
- Create: `artifacts/api-server/src/features/calls/call-workspace-query.test.ts`
- Create: `artifacts/api-server/src/features/calls/call-script.ts`
- Create: `artifacts/api-server/src/features/calls/call-script.test.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Create: `artifacts/adventure-zone/src/features/calls/call-scripts.ts`

**Interfaces:**
- Consumes: Task 1 phone records, booking `travelLegId/status`, `travelLegs`, and contact/booking activity dates.
- Produces: enriched `LoadedCallWorkspace` with `phones`, `contextSummary`, `defaultScriptKind`, and `scriptPrompts`.

- [ ] **Step 1: Write failing script selection tests**

```ts
expect(selectCallScript({ direction: "incoming", followUpKind: null, bookingStatus: null }))
  .toBe("incoming_inquiry");
expect(selectCallScript({ direction: "outgoing", followUpKind: "call", bookingStatus: "new_lead" }))
  .toBe("first_outreach");
expect(selectCallScript({ direction: "outgoing", followUpKind: "check_contract", bookingStatus: "pending_contract" }))
  .toBe("contract_follow_up");
expect(selectCallScript({ direction: "outgoing", followUpKind: "call", bookingStatus: "interested" }))
  .toBe("follow_up");
```

- [ ] **Step 2: Run the script tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/features/calls/call-script.test.ts`

Expected: FAIL because `selectCallScript` does not exist.

- [ ] **Step 3: Implement script selection and the four prompt sets**

```ts
export const callScriptPrompts: Record<CallScriptKind, string[]> = {
  first_outreach: ["Introduce Adventure Zone", "Confirm the event date and location", "Ask expected attendance", "Ask which package interests them", "Confirm the decision-maker", "Agree on the next step"],
  follow_up: ["Reference the previous conversation", "Confirm what changed", "Ask about concerns", "Confirm package interest", "Agree on the next step"],
  contract_follow_up: ["Confirm they received the proposal or contract", "Ask whether anything needs clarification", "Confirm deposit and decision timing", "Agree on the next step"],
  incoming_inquiry: ["Ask the caller's name and organization", "Confirm event date and location", "Ask expected attendance", "Ask package interest", "Capture the best callback details", "Agree on the next step"],
};
```

- [ ] **Step 4: Enrich the workspace query**

Return all contact phones, booking status, `travelLeg: { id, name, color } | null`, and `lastContactedAt`, defined as the greatest completed call end time or associated activity occurrence time. Return a user-facing booking-status label but keep the raw status for logic. Do not derive a route from area code.

- [ ] **Step 5: Run the script and existing workspace tests**

Run: `pnpm --filter @workspace/api-server test -- src/features/calls/call-script.test.ts src/features/calls/call-workspace-query.test.ts`

Expected: PASS. The query test uses a fake context repository, phone repository, and operations provider and asserts the enriched DTO without a live database.

- [ ] **Step 6: Commit workspace context**

```bash
git add artifacts/api-server/src/features/calls artifacts/api-server/src/routes/calls.ts artifacts/adventure-zone/src/features/calls/call-scripts.ts
git commit -m "feat: enrich call workspace context"
```

### Task 5: Build safe caller finding and duplicate suggestions

**Files:**
- Create: `artifacts/api-server/src/features/caller-finder/caller-finder-types.ts`
- Create: `artifacts/api-server/src/features/caller-finder/caller-finder-service.ts`
- Create: `artifacts/api-server/src/features/caller-finder/caller-finder-service.test.ts`
- Modify: `artifacts/api-server/src/features/contacts/quick-caller-service.ts`
- Create: `artifacts/api-server/src/features/contacts/quick-caller-service.test.ts`
- Modify: `artifacts/api-server/src/features/contacts/contact-repository.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`

**Interfaces:**
- Consumes: normalized phones, contact/organization/booking/location data, today's open follow-ups, recent activities, route legs, and quick-create input.
- Produces: `GET /calls/caller-finder?phone=&q=` returning `exact`, `suggestions`, and `canCreate`; quick-create result variant `{ ok:false, candidates: DuplicateCandidate[] }`.

- [ ] **Step 1: Write failing ranking and safety tests**

```ts
it("auto-opens only one exact normalized phone match", async () => {
  const result = await service.find({ phone: "(701) 555-0199", query: "" });
  expect(result.exact).toEqual({ kind: "one", contactId: exactContactId });
});

it("keeps area-code matches as clickable suggestions", async () => {
  const result = await service.find({ phone: "701-555-9999", query: "" });
  expect(result.exact).toEqual({ kind: "none" });
  expect(result.suggestions[0]).toMatchObject({
    contactId: dueTodayContactId,
    reasons: ["Same area code", "Due today"],
  });
});

it("does not search note bodies for two-character input", async () => {
  expect((await service.find({ phone: "", query: "az" })).suggestions)
    .not.toContainEqual(expect.objectContaining({ reasons: expect.arrayContaining(["Note text"]) }));
});
```

- [ ] **Step 2: Run caller-finder tests and verify the service is missing**

Run: `pnpm --filter @workspace/api-server test -- src/features/caller-finder/caller-finder-service.test.ts`

Expected: FAIL with a missing-module error.

- [ ] **Step 3: Define bounded result types and deterministic scoring**

```ts
export type CallerMatchReason =
  | "Exact phone" | "Exact email" | "Name" | "Organization or event"
  | "Due today" | "Recently contacted" | "Location" | "Route leg"
  | "Same area code" | "Note text";

export type CallerSuggestion = {
  contactId: string;
  name: string;
  organizationName: string | null;
  city: string | null;
  region: string | null;
  bookingStatus: string | null;
  routeLegName: string | null;
  lastContactedAt: Date | null;
  reasons: CallerMatchReason[];
  score: number;
};
```

Score exact phone 1000, exact email 900, strong name/organization 700, due today 300, recent activity 200, location/route 150, same area code 50, and note text 25. Return at most eight suggestions sorted by score descending, last-contacted descending with null last, then contact ID. Do not include note snippets unless `query.trim().length >= 3`; cap any snippet at 160 characters.

- [ ] **Step 4: Add duplicate candidate checks to quick create**

Before creation, block exact normalized phone or email. Return likely candidates for normalized name+organization and normalized name+location, with explicit `continueCreating: true` required to bypass only likely candidates. Never merge from quick create.

- [ ] **Step 5: Add the caller-finder route**

Validate `phone` and `q` lengths, call the service, and return only the bounded DTO. Do not expose raw notes or unbounded contact rows.

- [ ] **Step 6: Run finder, quick-create, and route tests**

Run: `pnpm --filter @workspace/api-server test -- src/features/caller-finder/caller-finder-service.test.ts src/features/contacts/quick-caller-service.test.ts src/routes/calls.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit caller finding**

```bash
git add artifacts/api-server/src/features/caller-finder artifacts/api-server/src/features/contacts artifacts/api-server/src/routes/calls.ts
git commit -m "feat: add safe caller suggestions"
```

### Task 6: Build shared phone actions, context, scripts, and draft-safe call workspace

**Files:**
- Create: `artifacts/adventure-zone/src/features/calls/call-draft.ts`
- Create: `artifacts/adventure-zone/src/features/calls/call-draft.test.ts`
- Create: `artifacts/adventure-zone/src/features/calls/phone-launcher.ts`
- Create: `artifacts/adventure-zone/src/features/calls/phone-launcher.test.ts`
- Create: `artifacts/adventure-zone/src/components/calls/phone-actions.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/call-context-row.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/call-script-card.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Create: `artifacts/api-server/src/routes/calls.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4 enriched workspace and completion contracts.
- Produces: reusable `CallWorkspace` modes `full | compact | mobile`, `CallDraft`, `PhoneActions`, and `GET /calls/config`.

- [ ] **Step 1: Write failing draft and launcher tests**

```ts
it("expires drafts after seven days", () => {
  storage.setItem(key, JSON.stringify({ version: 1, savedAt: "2026-08-01T00:00:00.000Z", note: "old" }));
  expect(loadCallDraft(key, new Date("2026-08-09T00:00:00.000Z"))).toBeNull();
});

it("builds a tel URL from the raw number without appending an office extension", () => {
  expect(buildTelHref({ number: "701-555-0100", extension: "12" })).toBe("tel:7015550100");
});

it("never reports voicemail delivery from a launcher click", async () => {
  expect(await launchIndividualVoicemail({ number: "701-555-0199", launcherUrl, clipboard }))
    .toEqual({ launched: true, delivery: "unknown" });
});
```

- [ ] **Step 2: Run the focused web tests and verify imports fail**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/features/calls/call-draft.test.ts src/features/calls/phone-launcher.test.ts`

Expected: FAIL with missing modules.

- [ ] **Step 3: Implement seven-day draft storage**

Use key `assisted-call-draft:v1:<organizationId|none>:<contactId|none>:<bookingId|none>:<followUpId|none>`. Store only request key, selected phone ID, direction, method, script kind, note, disposition, next-action kind/date, Last Resort/Do Not Call confirmations and reason, and ISO `savedAt`. Restore on mount, debounce saves by 300 ms, clear after confirmed completion or explicit discard, and retain on any API failure.

- [ ] **Step 4: Implement launch/copy behavior and server configuration**

`GET /calls/config` returns:

```ts
{
  assistedCallingEnabled: process.env.ASSISTED_CALLING_ENABLED === "true",
  voicemailLauncherUrl: process.env.VOICEMAIL_LAUNCH_URL || null,
}
```

`PhoneActions` filters out call/voicemail buttons when `doNotCallAt` is set. Mobile numbers show **Call** and **Leave voicemail**; office shows **Call office**, **Use extension**, and **Copy number**; unknown shows **Call** and **Leave voicemail** plus “May not work for office numbers.” The external action copies the number before opening the configured URL in a new tab and returns no delivery claim.

- [ ] **Step 5: Refactor the existing workspace into shared composition**

Preserve existing Last Resort warning, recent timeline, activity actions, idempotent completion, and next-action validation. Add the context row, phone selector/actions, script card, quick outcome buttons, Do Not Call confirmation, draft restore notice, and compact/full/mobile layout modes. In compact mode, recent history starts collapsed.

- [ ] **Step 6: Write and run workspace component tests**

Test mobile/office/unknown action labels, Do Not Call suppression, script switching, restored note display, save-success draft clearing, and save-failure draft retention.

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/calls/call-workspace.test.tsx src/features/calls/call-draft.test.ts src/features/calls/phone-launcher.test.ts`

Expected: PASS.

- [ ] **Step 7: Run API route tests and both typechecks**

Run: `pnpm --filter @workspace/api-server test -- src/routes/calls.test.ts && pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS.

- [ ] **Step 8: Commit the shared workspace**

```bash
git add artifacts/api-server/src/routes/calls.ts artifacts/api-server/src/routes/calls.test.ts artifacts/adventure-zone/src/features/calls artifacts/adventure-zone/src/components/calls artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx
git commit -m "feat: build assisted call workspace"
```

### Task 7: Add incoming caller finder and duplicate-safe quick creation UI

**Files:**
- Create: `artifacts/adventure-zone/src/components/calls/caller-finder.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/caller-finder.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/contacts/quick-add-caller.tsx`
- Create: `artifacts/adventure-zone/src/components/contacts/quick-add-caller.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/QuickAddPage.tsx`

**Interfaces:**
- Consumes: Task 5 caller-finder and duplicate-candidate API responses; Task 6 shared workspace route.
- Produces: `CallerFinder({ initialPhone?, onSelect })` and duplicate-safe create confirmation.

- [ ] **Step 1: Write failing UI tests for exact, possible, and new callers**

```tsx
it("opens the only exact match without showing area-code suggestions as certain", async () => {
  render(<CallerFinder initialPhone="7015550199" onSelect={onSelect} />);
  await waitFor(() => expect(onSelect).toHaveBeenCalledWith(exactContactId));
});

it("requires a click for area-code suggestions", async () => {
  render(<CallerFinder initialPhone="7015559999" onSelect={onSelect} />);
  expect(await screen.findByText("Possible callers")).toBeVisible();
  expect(onSelect).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /Sarah Miller.*Prairie Days/i }));
  expect(onSelect).toHaveBeenCalledWith(sarahId);
});
```

- [ ] **Step 2: Run the component test and verify failure**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/calls/caller-finder.test.tsx`

Expected: FAIL because `CallerFinder` does not exist.

- [ ] **Step 3: Implement debounced unified finder**

Use one input labeled **Find caller** for phone, name, organization/event, email, city/state/ZIP/county, route leg, status, and note terms. Query after 250 ms. Render why each result matched and show name, organization/event, city/state, booking status, route leg, and last contacted. Keep **Create contact** visible when no exact match exists.

- [ ] **Step 4: Extend quick creation to show duplicate candidates**

When the API returns likely candidates, render cards with **Open profile** and **Create separate contact**. The second action resubmits the same request key with `continueCreating: true`. Exact phone/email conflicts do not offer the bypass.

- [ ] **Step 5: Run finder and quick-create tests plus web typecheck**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/calls/caller-finder.test.tsx src/components/contacts/quick-add-caller.test.tsx && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS. The quick-add test covers an exact conflict with no bypass and a likely candidate that requires an explicit **Create separate contact** click.

- [ ] **Step 6: Commit incoming caller UI**

```bash
git add artifacts/adventure-zone/src/components/calls/caller-finder.tsx artifacts/adventure-zone/src/components/calls/caller-finder.test.tsx artifacts/adventure-zone/src/components/contacts/quick-add-caller.tsx artifacts/adventure-zone/src/components/contacts/quick-add-caller.test.tsx artifacts/adventure-zone/src/pages/QuickAddPage.tsx
git commit -m "feat: add incoming caller finder"
```

### Task 8: Integrate the split call queue into Today

**Files:**
- Modify: `artifacts/api-server/src/features/follow-ups/today-query.ts`
- Modify: `artifacts/api-server/src/routes/today.ts`
- Create: `artifacts/adventure-zone/src/components/today/call-queue-workspace.tsx`
- Create: `artifacts/adventure-zone/src/components/today/call-queue-workspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/today/follow-up-list.tsx`
- Modify: `artifacts/adventure-zone/src/pages/TodayPage.tsx`

**Interfaces:**
- Consumes: existing prioritized follow-ups, Task 6 compact workspace, and `/calls/config` feature flag.
- Produces: selected-follow-up state and inline call workspace on Today with standalone fallback when disabled.

- [ ] **Step 1: Write failing Today workspace tests**

```tsx
it("keeps the queue visible while loading the selected caller", async () => {
  render(<CallQueueWorkspace followUps={followUps} initialFollowUpId={followUps[0].id} />);
  expect(screen.getByRole("heading", { name: "Calls to make" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /Tom Erickson/i }));
  expect(await screen.findByRole("heading", { name: "Tom Erickson" })).toBeVisible();
  expect(screen.getByRole("button", { name: /Sarah Miller/i })).toBeVisible();
});

it("stacks the selected workspace after the queue on a narrow viewport", () => {
  setViewport(390, 844);
  render(<CallQueueWorkspace followUps={followUps} />);
  expect(screen.getByTestId("call-queue-layout")).toHaveClass("grid-cols-1");
});
```

- [ ] **Step 2: Run the Today component test and verify failure**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/today/call-queue-workspace.test.tsx`

Expected: FAIL because the split workspace does not exist.

- [ ] **Step 3: Enrich the Today queue DTO**

Expose contact name, organization name, booking status, route leg name/color, last-contacted date, and enough IDs to load `/calls/workspace`. Preserve the existing priority ordering and pagination. Name the visible section **Calls to make** and show the remaining count.

- [ ] **Step 4: Implement desktop split and mobile stacked layouts**

Use `lg:grid-cols-[minmax(18rem,.8fr)_minmax(0,1.2fr)]`. Selecting an item updates local state and loads the compact workspace without navigation. On save, refresh `/today`, remove/completed the queue item, and select the next item. If context loading fails, keep the queue visible and show **Try again** plus the existing standalone workspace link.

- [ ] **Step 5: Gate the new Today layout**

Load `/calls/config` once. When `assistedCallingEnabled` is false or the request fails, retain the current FollowUpList + NextCallCard behavior. Do not display “Phone Link ready.”

- [ ] **Step 6: Run Today tests and typechecks**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/components/today/call-queue-workspace.test.tsx && pnpm --filter @workspace/api-server typecheck && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS.

- [ ] **Step 7: Commit Today integration**

```bash
git add artifacts/api-server/src/features/follow-ups/today-query.ts artifacts/api-server/src/routes/today.ts artifacts/adventure-zone/src/components/today artifacts/adventure-zone/src/pages/TodayPage.tsx
git commit -m "feat: add call queue workspace to today"
```

### Task 9: Add mobile call logging and profile entry points

**Files:**
- Create: `artifacts/adventure-zone/src/pages/MobileCallLogPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/MobileCallLogPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/ContactDetailPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/ContactDetailPage.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/EventProfilePage.tsx`
- Create: `artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- Consumes: Task 6 mobile workspace, Task 7 caller finder, and existing event/contact IDs.
- Produces: `/calls/log` and consistent profile actions into `/calls/new` or `/calls/log`.

- [ ] **Step 1: Write failing mobile flow tests**

```tsx
it("finds a caller and opens the mobile logging form", async () => {
  render(<MobileCallLogPage />);
  await user.type(screen.getByLabelText("Find caller"), "Prairie Days");
  await user.click(await screen.findByRole("button", { name: /Sarah Miller/i }));
  expect(screen.getByRole("heading", { name: "Log call" })).toBeVisible();
  expect(screen.getByLabelText("Call note")).toBeVisible();
});

it("defaults a mobile log to incoming without attempting audio capture", async () => {
  render(<MobileCallLogPage contactId={contactId} />);
  expect(screen.getByLabelText("Direction")).toHaveValue("incoming");
  expect(screen.queryByText(/record|transcrib/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the mobile page test and verify failure**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/MobileCallLogPage.test.tsx`

Expected: FAIL because the page and route do not exist.

- [ ] **Step 3: Implement the mobile call log route**

Add `/calls/log`. With no contact, show `CallerFinder`; after selection, load the mobile workspace with `method='mobile_log'` and user-selectable direction defaulting to incoming. Keep notes, outcomes, follow-up creation, draft recovery, and Do Not Call confirmation. Rely on the device keyboard for optional voice dictation and include no audio permission request.

- [ ] **Step 4: Add profile actions**

On contact details, show **Call** and **Log call** using the shared contact ID. On event profiles, show the same actions with organization/contact/booking IDs so the correct context loads. Disable call/voicemail actions for suppressed numbers while leaving **Log call** available for historical logging.

- [ ] **Step 5: Run mobile/profile tests and web typecheck**

Run: `pnpm --filter @workspace/adventure-zone exec vitest run src/pages/MobileCallLogPage.test.tsx src/pages/ContactDetailPage.test.tsx src/pages/EventProfilePage.test.tsx && pnpm --filter @workspace/adventure-zone typecheck`

Expected: PASS. The two profile tests assert that call and log URLs contain the correct contact, organization, and booking IDs.

- [ ] **Step 6: Commit mobile and profile entry points**

```bash
git add artifacts/adventure-zone/src/pages/MobileCallLogPage.tsx artifacts/adventure-zone/src/pages/MobileCallLogPage.test.tsx artifacts/adventure-zone/src/pages/ContactDetailPage.tsx artifacts/adventure-zone/src/pages/ContactDetailPage.test.tsx artifacts/adventure-zone/src/pages/EventProfilePage.tsx artifacts/adventure-zone/src/pages/EventProfilePage.test.tsx artifacts/adventure-zone/src/App.tsx
git commit -m "feat: add mobile call logging"
```

### Task 10: Verify migration, full workflow, accessibility, and rollout controls

**Files:**
- Modify: `render.yaml`
- Modify: `DEPLOY.md`
- Create: `docs/assisted-calling-runbook.md`
- Create: `artifacts/api-server/src/features/calls/assisted-calling.integration.test.ts`

**Interfaces:**
- Consumes: Tasks 1–9.
- Produces: deployment configuration, production-safe enablement instructions, and end-to-end regression evidence.

- [ ] **Step 1: Write the integration test for the complete workflow**

The integration test must create an organization, contact with mobile+office phones, booking, route leg, and due call; load Today; load the enriched workspace; complete an office call with a follow-up; verify the immutable snapshot and completed original follow-up; run exact and area-code caller finding; then mark the mobile number Do Not Call and verify call actions are suppressed without Last Resort changing.

```ts
expect(completedSession).toMatchObject({
  direction: "outgoing",
  method: "office_call",
  phoneNumberSnapshot: "701-555-0100",
  phoneExtensionSnapshot: "12",
  scriptKind: "follow_up",
});
expect(originalFollowUp.completedAt).not.toBeNull();
expect(nextFollowUp).toMatchObject({ kind: "call" });
expect(organization.lastResort).toBe(false);
```

- [ ] **Step 2: Run the integration test and fix only cross-task contract defects**

Run: `pnpm --filter @workspace/api-server test -- src/features/calls/assisted-calling.integration.test.ts`

Expected: PASS after correcting any contract mismatch; do not expand scope into transcription, bulk voicemail, or automatic Phone Link detection.

- [ ] **Step 3: Document rollout and rollback**

`docs/assisted-calling-runbook.md` must state:

1. Deploy code with `ASSISTED_CALLING_ENABLED=false`.
2. Run registered DB migrations and verify one `contact_phones` primary row for each legacy nonblank contact phone.
3. Set optional `VOICEMAIL_LAUNCH_URL` and verify the UI still uses **Leave voicemail**.
4. Set `ASSISTED_CALLING_ENABLED=true` for the owner deployment.
5. Complete one test call, one office-extension call, one voicemail log, one incoming lookup, and one mobile log.
6. Confirm no delivery/connection claims appear.
7. Roll back the UI by setting the feature flag false; retain the additive database migration and recorded call data.

Document both environment variables in `render.yaml` and `DEPLOY.md` without committing a real private URL or phone number.

- [ ] **Step 4: Run the full automated verification suite**

Run: `pnpm --filter @workspace/api-server test && pnpm --filter @workspace/adventure-zone exec vitest run && pnpm run typecheck && pnpm run build`

Expected: all tests, typechecks, and builds PASS.

- [ ] **Step 5: Perform manual desktop and mobile verification**

Verify at desktop and 390×844 viewport:

- Today queue remains visible beside/above the active caller.
- Booking status, route leg, and last contacted render correctly.
- Mobile, office, extension, unknown, Copy number, and Do Not Call states use the approved simple wording.
- Exact caller match opens automatically; area-code/location suggestions require a click and show match reasons.
- Refresh restores an unfinished note; failed save retains it; successful save clears it.
- Keyboard-only navigation has visible focus; labels are announced; touch targets are at least 44×44 CSS pixels.
- `tel:` launches the configured handler when available and Copy number remains usable when it does not.
- Voicemail launch never changes the outcome until the user explicitly saves **Left voicemail**.

- [ ] **Step 6: Commit rollout documentation and final verification**

```bash
git add render.yaml DEPLOY.md docs/assisted-calling-runbook.md artifacts/api-server/src/features/calls/assisted-calling.integration.test.ts
git commit -m "docs: add assisted calling rollout"
```

- [ ] **Step 7: Request final code review before deployment**

Invoke `superpowers:requesting-code-review`, address only findings within this approved design, rerun the full verification command, and keep `ASSISTED_CALLING_ENABLED=false` until the migration/backfill checks in the runbook succeed.
