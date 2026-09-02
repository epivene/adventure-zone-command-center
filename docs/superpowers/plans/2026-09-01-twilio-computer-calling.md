# Twilio Computer Calling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, outbound-only browser calling to the guided Call Workspace so the recipient sees the verified Adventure Zone work number while incoming calls and callbacks continue to reach the physical work phone.

**Architecture:** The authenticated browser obtains a short-lived Twilio Voice SDK token, asks the API to create a one-time call intent for a stored contact phone, and connects with only the opaque intent ID. A signed Twilio webhook consumes that intent, resolves the server-approved destination, and returns TwiML that dials from the verified work number. A provider-neutral technical session records status and timestamps; the existing Call Workspace remains the source of truth for notes and outcomes and links its business call record using the technical session ID as `requestKey`.

**Tech Stack:** TypeScript, Express 5, Zod, Drizzle/PostgreSQL, React 19, Vite, TanStack Query, Twilio Node SDK, Twilio Voice JavaScript SDK, Vitest, Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-01-twilio-computer-calling-design.md`

## Global Constraints

- This release is live outbound browser calling only. Do not add Slybroadcast, voicemail drops, inbound browser calls, recording, transcription, AI voice processing, or a Voicemod API integration.
- Voicemod may be selected later as an ordinary virtual microphone; do not give it credentials or special server access.
- Never accept a destination phone number from the browser. Accept a stored `phoneId`, resolve it on the server, and enforce ownership, relationship context, do-not-call, and suppression rules.
- Keep Twilio credentials server-only. Do not log or persist access tokens, API secrets, media, recordings, transcripts, raw webhook bodies, or browser device labels.
- Require an explicit final **Call now** action after device setup and contact confirmation.
- Preserve the existing `tel:` / Phone Link path as the fallback.
- Fail closed when the feature flag or required configuration is missing. Default `TWILIO_VOICE_ENABLED` to false.
- Validate every public Twilio webhook with `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` and the exact public URL built from `TWILIO_WEBHOOK_BASE_URL` plus `req.originalUrl`.
- Treat Twilio retries idempotently: the same `CallSid` may receive the same TwiML; a different `CallSid`, an expired intent, or reuse after binding must fail.
- Use `owner` as the stable browser token identity inside the owner-protected computer-calling router; do not change the existing global authentication actor namespace.
- Do not make a real phone call in automated tests. Enable the feature only after Twilio credentials and a verified caller ID are available.

---

## Task 1: Add fail-closed configuration and provider-neutral contracts

**Files:**

- Create: `artifacts/api-server/src/features/calls/computer-calling-config.ts`
- Create: `artifacts/api-server/src/features/calls/computer-calling-config.test.ts`
- Create: `artifacts/api-server/src/features/calls/computer-calling-types.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Modify: `artifacts/api-server/src/routes/calls.test.ts`

**Interfaces:**

- Consumes environment variables: `TWILIO_VOICE_ENABLED`, `TWILIO_ACCOUNT_SID`, `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET`, `TWILIO_AUTH_TOKEN`, `TWILIO_TWIML_APP_SID`, `TWILIO_VERIFIED_CALLER_ID`, `TWILIO_WEBHOOK_BASE_URL`.
- Produces internal `ComputerCallingConfig`, public `ComputerCallingCapability`, `ComputerCallStatus`, and `ComputerCallSession` types.
- Extends `GET /calls/config` with `computerCalling: { enabled, reason, callerIdDisplay }` without exposing secrets.

- [ ] Write `computer-calling-config.test.ts` first. Cover disabled-by-default, explicitly disabled, incomplete configuration, invalid HTTPS webhook base URL, invalid E.164 caller ID, and complete configuration. Assert that the public capability never contains a SID, secret, or auth token.

```ts
it("fails closed when one required credential is missing", () => {
  const result = readComputerCallingConfig({
    TWILIO_VOICE_ENABLED: "true",
    TWILIO_ACCOUNT_SID: "AC123",
    TWILIO_API_KEY_SID: "SK123",
    TWILIO_API_KEY_SECRET: "secret",
    TWILIO_AUTH_TOKEN: "auth",
    TWILIO_TWIML_APP_SID: "AP123",
    TWILIO_VERIFIED_CALLER_ID: "+15551234567",
  });

  expect(result.capability).toEqual({
    enabled: false,
    reason: "configuration_incomplete",
    callerIdDisplay: null,
  });
});
```

- [ ] Run the focused test and confirm it fails because the module does not exist.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/computer-calling-config.test.ts
```

- [ ] Add provider-neutral types with these exact unions and public shapes.

```ts
export type ComputerCallProvider = "twilio";

export type ComputerCallStatus =
  | "created"
  | "queued"
  | "ringing"
  | "in-progress"
  | "completed"
  | "busy"
  | "no-answer"
  | "canceled"
  | "failed"
  | "unknown";

export interface ComputerCallingCapability {
  enabled: boolean;
  reason: "available" | "disabled" | "configuration_incomplete";
  callerIdDisplay: string | null;
}

export interface ComputerCallSession {
  id: string;
  status: ComputerCallStatus;
  startedAt: string | null;
  answeredAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  errorSummary: string | null;
}
```

- [ ] Implement `readComputerCallingConfig(env)` as a pure parser. Return full credentials only when enabled and complete; return a public disabled capability otherwise. Require `https:` for the webhook base URL except in `NODE_ENV=test`, where `http://localhost` is allowed.

```ts
export type ComputerCallingConfigResult =
  | { enabled: true; config: ComputerCallingConfig; capability: ComputerCallingCapability }
  | { enabled: false; capability: ComputerCallingCapability };
```

- [ ] Extend `/calls/config` and its route test. Keep `assistedCallingEnabled` and `voicemailLauncherUrl` unchanged and add the nested capability.
- [ ] Run the focused tests and confirm they pass.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/computer-calling-config.test.ts src/routes/calls.test.ts
```

- [ ] Commit the task.

```bash
git add artifacts/api-server/src/features/calls/computer-calling-config.ts artifacts/api-server/src/features/calls/computer-calling-config.test.ts artifacts/api-server/src/features/calls/computer-calling-types.ts artifacts/api-server/src/routes/calls.ts artifacts/api-server/src/routes/calls.test.ts
git commit -m "feat(calls): add computer calling configuration"
```

---

## Task 2: Persist provider-neutral technical call sessions

**Files:**

- Create: `lib/db/migrations/20260901_twilio_computer_calling.sql`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/db/computer-calling-required-startup.ts`
- Create: `artifacts/api-server/src/db/computer-calling-required-startup.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.test.ts`

**Interfaces:**

- Produces `computer_call_sessions`, a technical lifecycle table separate from the existing outcome-oriented `call_sessions` table.
- Extends the existing `call_sessions_method_valid` constraint with `browser_voip`.
- Makes schema startup idempotently guarantee the new table, indexes, and updated method constraint under the existing advisory-lock pattern.

- [ ] Write startup tests first. Mock the database client and assert the startup SQL is invoked once, can run twice without error, and is included by `ensureRequiredSchema()`.

```ts
it("installs computer calling schema during required startup", async () => {
  await ensureRequiredSchema(db);
  expect(db.execute).toHaveBeenCalledWith(
    expect.objectContaining({ sql: expect.stringContaining("computer_call_sessions") }),
  );
});
```

- [ ] Run the focused startup tests and confirm the new import/assertion fails.

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/computer-calling-required-startup.test.ts src/db/required-schema-startup.test.ts
```

- [ ] Add the migration and matching Drizzle table definition. Use UUID primary key generation and foreign keys to the existing organization, contact, and contact phone tables. Add these columns exactly:

```text
id uuid primary key
owner_id text not null
organization_id uuid not null
contact_id uuid not null
phone_id uuid not null
provider text not null
provider_call_sid text unique
status text not null
caller_id_snapshot text not null
destination_number_snapshot text not null
intent_expires_at timestamptz not null
intent_consumed_at timestamptz
created_at timestamptz not null
started_at timestamptz
answered_at timestamptz
ended_at timestamptz
updated_at timestamptz not null
duration_seconds integer
error_code text
error_summary text
```

- [ ] Add checks for `provider = 'twilio'`, the complete provider-neutral status union, and nonnegative `duration_seconds`. Add indexes for `(owner_id, created_at desc)`, `phone_id`, and `provider_call_sid`.
- [ ] Replace the existing `call_sessions_method_valid` check so it accepts `standard_call`, `office_call`, `individual_voicemail`, `mobile_log`, and `browser_voip`.
- [ ] Implement the required-startup module using the same transaction and advisory-lock conventions as `organizer-feedback-required-startup.ts`. Keep the migration and startup SQL semantically identical.
- [ ] Run the startup tests and the database package typecheck.

```bash
pnpm --filter @workspace/api-server exec vitest run src/db/computer-calling-required-startup.test.ts src/db/required-schema-startup.test.ts
pnpm --filter @workspace/db typecheck
```

- [ ] Commit the task.

```bash
git add lib/db/migrations/20260901_twilio_computer_calling.sql lib/db/src/schema/index.ts artifacts/api-server/src/db/computer-calling-required-startup.ts artifacts/api-server/src/db/computer-calling-required-startup.test.ts artifacts/api-server/src/db/required-schema-startup.ts artifacts/api-server/src/db/required-schema-startup.test.ts
git commit -m "feat(db): add computer call sessions"
```

---

## Task 3: Create one-time call intents from stored contact phones

**Files:**

- Create: `artifacts/api-server/src/features/calls/nanp-phone.ts`
- Create: `artifacts/api-server/src/features/calls/nanp-phone.test.ts`
- Create: `artifacts/api-server/src/features/calls/computer-call-repository.ts`
- Create: `artifacts/api-server/src/features/calls/computer-call-repository.test.ts`
- Create: `artifacts/api-server/src/features/calls/computer-calling-service.ts`
- Create: `artifacts/api-server/src/features/calls/computer-calling-service.test.ts`

**Interfaces:**

- Consumes `{ ownerId: "owner", organizationId, contactId, phoneId }`; never consumes a raw destination.
- Produces a two-minute one-time intent represented by a `computer_call_sessions` row in `created` state.
- Consumes Twilio `CallSid` at webhook time and atomically binds it to the intent.
- Produces idempotent session status updates for signed status callbacks and owner-scoped reads for UI reconciliation.

- [ ] Write NANP normalization tests first: accept ten digits as `+1...`, accept eleven digits beginning with `1`, ignore common punctuation, and reject extensions, short/service codes, non-NANP values, and malformed input.

```ts
it.each([
  ["(555) 123-4567", "+15551234567"],
  ["1-555-123-4567", "+15551234567"],
])("normalizes %s", (input, expected) => {
  expect(normalizeNanpPhone(input)).toBe(expected);
});
```

- [ ] Run the NANP test and confirm it fails because the module does not exist, then implement the smallest pure normalizer and rerun it.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/nanp-phone.test.ts
```

- [ ] Write repository tests first using the project database test pattern. Cover create, owner-scoped get, same-`CallSid` retry, different-`CallSid` rejection, expired intent rejection, concurrent consume behavior, unique provider SID, and idempotent terminal status updates.

```ts
export interface ComputerCallRepository {
  createIntent(input: CreateComputerCallIntentRecord): Promise<ComputerCallIntentRecord>;
  consumeIntent(input: { id: string; providerCallSid: string; now: Date }): Promise<ConsumeIntentResult>;
  updateProviderStatus(input: ProviderStatusUpdate): Promise<ComputerCallSessionRecord | null>;
  getSessionForOwner(input: { id: string; ownerId: string }): Promise<ComputerCallSessionRecord | null>;
}

export type ConsumeIntentResult =
  | { kind: "consumed" | "retry"; session: ComputerCallSessionRecord }
  | { kind: "expired" | "already_bound" | "not_found" };
```

- [ ] Run repository tests and confirm they fail, then implement atomic SQL/Drizzle operations. `consumeIntent` must bind only when unconsumed and unexpired; on conflict, read back and return `retry` only when the same SID is already bound.
- [ ] Write service tests first with repository and contact lookups mocked. Cover missing phone, phone/contact mismatch, missing relationship context, DNC/suppression, missing full number, invalid NANP, disabled feature, successful two-minute expiry, intent consumption, and public session serialization.

```ts
export interface ComputerCallingService {
  createIntent(input: {
    ownerId: "owner";
    organizationId: string;
    contactId: string;
    phoneId: string;
    now: Date;
  }): Promise<{ sessionId: string; expiresAt: string }>;
  consumeIntent(input: { sessionId: string; providerCallSid: string; now: Date }): Promise<ConsumedCallIntent>;
  applyProviderStatus(input: ProviderStatusUpdate): Promise<void>;
  getSession(input: { ownerId: "owner"; sessionId: string }): Promise<ComputerCallSession>;
}
```

- [ ] Implement server-side phone resolution using the existing contact/organization relationship and suppression data. Snapshot the caller ID and normalized destination in the technical session so retries do not change the dial target.
- [ ] Map internal validation failures to stable codes: `feature_disabled`, `phone_not_found`, `phone_context_mismatch`, `calling_suppressed`, `phone_invalid`, `intent_expired`, and `intent_already_used`.
- [ ] Run all task tests.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/nanp-phone.test.ts src/features/calls/computer-call-repository.test.ts src/features/calls/computer-calling-service.test.ts
```

- [ ] Commit the task.

```bash
git add artifacts/api-server/src/features/calls/nanp-phone.ts artifacts/api-server/src/features/calls/nanp-phone.test.ts artifacts/api-server/src/features/calls/computer-call-repository.ts artifacts/api-server/src/features/calls/computer-call-repository.test.ts artifacts/api-server/src/features/calls/computer-calling-service.ts artifacts/api-server/src/features/calls/computer-calling-service.test.ts
git commit -m "feat(calls): add secure one-time call intents"
```

---

## Task 4: Isolate Twilio behind a computer voice provider adapter

**Files:**

- Modify: `artifacts/api-server/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/api-server/src/features/calls/computer-voice-provider.ts`
- Create: `artifacts/api-server/src/features/calls/twilio-computer-voice-provider.ts`
- Create: `artifacts/api-server/src/features/calls/twilio-computer-voice-provider.test.ts`

**Interfaces:**

- Consumes complete internal Twilio configuration and provider-neutral consumed intents/status payloads.
- Produces short-lived browser access tokens, signature validation, no-recording outbound TwiML, and normalized provider statuses.
- Does not expose Twilio SDK objects outside the adapter.

- [ ] Add the `twilio` package to the API server with pnpm so `package.json` and the lockfile change together.

```bash
pnpm --filter @workspace/api-server add twilio
```

- [ ] Write adapter tests before implementation. Freeze time and verify token identity `owner`, a VoiceGrant with the configured outgoing application SID, a short expiry, exact webhook signature delegation, XML escaping, verified caller ID, status callback URL, DTMF-compatible `<Number>`, no `<Record>`, and complete status normalization.

```ts
export interface ComputerVoiceProvider {
  createBrowserToken(input: { identity: "owner"; ttlSeconds: number }): string;
  validateWebhook(input: { signature: string; url: string; params: Record<string, string> }): boolean;
  createOutboundTwiml(input: {
    destination: string;
    callerId: string;
    statusCallbackUrl: string;
  }): string;
  normalizeStatus(status: string): ComputerCallStatus;
}
```

- [ ] Run the focused test and confirm it fails because the adapter is absent.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/twilio-computer-voice-provider.test.ts
```

- [ ] Implement the adapter with Twilio `AccessToken`, `VoiceGrant`, `validateRequest`, and `twiml.VoiceResponse`. Set token TTL to 300 seconds. Set `<Dial answerOnBridge="true" record="do-not-record">`, a 30-second timeout, and a `<Number>` status callback for `initiated ringing answered completed`.
- [ ] Normalize unrecognized Twilio statuses to `unknown`; never throw solely because Twilio introduced a new status string.
- [ ] Rerun the focused test and API server typecheck.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/twilio-computer-voice-provider.test.ts
pnpm --filter @workspace/api-server typecheck
```

- [ ] Commit the task.

```bash
git add artifacts/api-server/package.json pnpm-lock.yaml artifacts/api-server/src/features/calls/computer-voice-provider.ts artifacts/api-server/src/features/calls/twilio-computer-voice-provider.ts artifacts/api-server/src/features/calls/twilio-computer-voice-provider.test.ts
git commit -m "feat(calls): add Twilio voice provider adapter"
```

---

## Task 5: Expose owner APIs and signed Twilio webhooks

**Files:**

- Create: `artifacts/api-server/src/features/calls/computer-calling-rate-limit.ts`
- Create: `artifacts/api-server/src/features/calls/computer-calling-rate-limit.test.ts`
- Create: `artifacts/api-server/src/routes/computer-calling.ts`
- Create: `artifacts/api-server/src/routes/computer-calling.test.ts`
- Create: `artifacts/api-server/src/routes/twilio-voice-webhooks.ts`
- Create: `artifacts/api-server/src/routes/twilio-voice-webhooks.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

- Owner routes after `requireOwnerMiddleware`:
  - `POST /calls/computer/token` → `{ token, expiresAt }`
  - `POST /calls/computer/intents` with `{ organizationId, contactId, phoneId }` → `{ sessionId, expiresAt }`
  - `GET /calls/computer/sessions/:id` → `ComputerCallSession`
- Public routes before `requireOwnerMiddleware`, but internally signature-protected:
  - `POST /webhooks/twilio/voice/outbound` with Twilio form fields including `CallSid` and opaque `sessionId` → TwiML
  - `POST /webhooks/twilio/voice/status` with Twilio form fields → empty `204`
- Rate limits token and intent creation by authenticated owner and source IP; the limiter is injectable and deterministic in tests.

- [ ] Write rate limiter tests first for allowed bursts, exhausted windows, independent keys, and reset after the window. Use a conservative default of 10 tokens and 10 intents per five minutes per owner/IP key.
- [ ] Write owner route tests first. Cover owner authentication, Zod validation, disabled feature, rate limits, no raw destination field, token response, intent response, owner-scoped session reads, and stable error codes.

```ts
it("rejects a browser-supplied destination", async () => {
  const response = await request(app)
    .post("/calls/computer/intents")
    .set(ownerAuthHeader)
    .send({ organizationId, contactId, phoneId, destination: "+15551234567" });

  expect(response.status).toBe(400);
});
```

- [ ] Run the owner route tests and confirm they fail because the router is missing.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/computer-calling-rate-limit.test.ts src/routes/computer-calling.test.ts
```

- [ ] Implement the owner router with strict Zod objects, identity `owner`, dependency injection for service/provider/clock/limiter, `Cache-Control: no-store` for tokens, and generic server logs that omit tokens and destinations.
- [ ] Write webhook tests first. Cover missing/invalid signatures, exact URL validation, invalid form payload, successful TwiML, expired intent, same-`CallSid` retry returning identical TwiML, different-`CallSid` rejection, status normalization, idempotent duplicate callbacks, and no owner token requirement.
- [ ] Build the signature URL as `new URL(req.originalUrl, config.webhookBaseUrl).toString()`. Pass the parsed form field map to validation; do not reconstruct only selected fields.
- [ ] Implement the webhook router before the owner middleware in `routes/index.ts`; mount the authenticated computer router after the owner middleware. Return generic `403` for signature failures and do not reveal whether an intent exists.
- [ ] Run all route tests.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/computer-calling-rate-limit.test.ts src/routes/computer-calling.test.ts src/routes/twilio-voice-webhooks.test.ts src/routes/calls.test.ts
```

- [ ] Commit the task.

```bash
git add artifacts/api-server/src/features/calls/computer-calling-rate-limit.ts artifacts/api-server/src/features/calls/computer-calling-rate-limit.test.ts artifacts/api-server/src/routes/computer-calling.ts artifacts/api-server/src/routes/computer-calling.test.ts artifacts/api-server/src/routes/twilio-voice-webhooks.ts artifacts/api-server/src/routes/twilio-voice-webhooks.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(api): add computer call routes and Twilio webhooks"
```

---

## Task 6: Build a testable browser calling controller

**Files:**

- Modify: `artifacts/adventure-zone/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `artifacts/adventure-zone/src/features/calls/computer-calling-types.ts`
- Create: `artifacts/adventure-zone/src/features/calls/computer-calling-api.ts`
- Create: `artifacts/adventure-zone/src/features/calls/twilio-browser-device.ts`
- Create: `artifacts/adventure-zone/src/hooks/use-computer-call.ts`
- Create: `artifacts/adventure-zone/src/hooks/use-computer-call.test.tsx`

**Interfaces:**

- Consumes only the owner API token, opaque call intent ID, and browser media device IDs.
- Produces the UI state machine: `idle`, `checking-devices`, `ready`, `requesting-intent`, `connecting`, `ringing`, `connected`, `ending`, `completed`, `failed`.
- Exposes `setup`, `callNow`, `mute`, `sendDigits`, `hangUp`, `selectInput`, `selectOutput`, and `reset` actions plus transient device lists and session timestamps.
- Encapsulates all `@twilio/voice-sdk` types in an adapter so hook tests use a fake device.

- [ ] Add the browser SDK with pnpm so package metadata and lockfile remain synchronized.

```bash
pnpm --filter @workspace/adventure-zone add @twilio/voice-sdk
```

- [ ] Define the adapter contract before importing Twilio in production code.

```ts
export interface BrowserVoiceDevice {
  prepare(token: string): Promise<void>;
  connect(params: { sessionId: string }): Promise<BrowserVoiceCall>;
  listAudioDevices(): Promise<{ inputs: MediaDeviceInfo[]; outputs: MediaDeviceInfo[] }>;
  selectInput(deviceId: string): Promise<void>;
  selectOutput(deviceId: string): Promise<boolean>;
  destroy(): Promise<void>;
}

export interface BrowserVoiceCall {
  mute(value: boolean): void;
  sendDigits(value: string): void;
  disconnect(): void;
  on(event: "ringing" | "accept" | "disconnect" | "cancel" | "error", listener: (...args: unknown[]) => void): void;
}
```

- [ ] Write hook tests first with a fake API and fake voice device. Cover every allowed transition, denied microphone permission, no devices, setup without dialing, explicit `callNow`, only opaque `sessionId` sent to Twilio, ringing/accept/disconnect/error events, mute, DTMF validation, input/output selection, unsupported output switching, double-click prevention, hangup, cleanup on unmount, and retry from failed.

```ts
it("does not dial during device setup", async () => {
  const { result } = renderHook(() => useComputerCall(deps));
  await act(() => result.current.setup());
  expect(result.current.state.phase).toBe("ready");
  expect(fakeDevice.connect).not.toHaveBeenCalled();
});
```

- [ ] Run the hook test and confirm it fails because the hook is absent.

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/hooks/use-computer-call.test.tsx
```

- [ ] Implement `computer-calling-api.ts` using the existing authenticated fetch conventions. Reject unexpected response shapes and keep access tokens only in function/hook memory.
- [ ] Implement the Twilio adapter with `Device`, `device.audio.setInputDevice`, supported speaker selection, and complete listener teardown. Do not persist device labels or IDs.
- [ ] Implement the hook as an explicit reducer/state machine. A second `callNow` while requesting or active must be a no-op. On disconnect, fetch the technical session once for authoritative timestamps; if reconciliation fails, preserve local timestamps and a nonblocking warning.
- [ ] Rerun the hook tests and frontend typecheck.

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/hooks/use-computer-call.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] Commit the task.

```bash
git add artifacts/adventure-zone/package.json pnpm-lock.yaml artifacts/adventure-zone/src/features/calls/computer-calling-types.ts artifacts/adventure-zone/src/features/calls/computer-calling-api.ts artifacts/adventure-zone/src/features/calls/twilio-browser-device.ts artifacts/adventure-zone/src/hooks/use-computer-call.ts artifacts/adventure-zone/src/hooks/use-computer-call.test.tsx
git commit -m "feat(calls): add browser voice controller"
```

---

## Task 7: Integrate computer calling into the guided Call Workspace

**Files:**

- Create: `artifacts/adventure-zone/src/components/calls/computer-call-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/computer-call-panel.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/phone-actions.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/phone-actions.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/calls/call-types.ts`
- Modify: `artifacts/adventure-zone/src/actions/calls.ts`
- Modify: `artifacts/api-server/src/features/calls/call-types.ts`
- Modify: `artifacts/api-server/src/features/calls/call-input.ts`
- Modify: `artifacts/api-server/src/features/calls/call-service.test.ts`

**Interfaces:**

- Adds `browser_voip` to frontend/backend `CallMethod` and completion validation.
- Consumes the nested `computerCalling` capability from `/calls/config`.
- Emits `{ sessionId, startedAt, endedAt }` from the computer panel to the workspace.
- Uses `sessionId` as the existing business call `requestKey`, `browser_voip` as method, and the authoritative technical timestamps; no new business-table foreign key is needed.

- [ ] Extend backend call input/service tests first to prove `browser_voip` is accepted and all existing methods still work. Run them and observe the method validation failure.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/call-service.test.ts
```

- [ ] Add `browser_voip` to frontend/backend method unions and strict validation, then rerun the backend test.
- [ ] Write `phone-actions.test.tsx` first. When capability is enabled, assert **Call from computer** opens the panel and **Call with Phone Link** still uses the existing `tel:` behavior. When disabled or incomplete, assert only the existing fallback is actionable and the reason is readable.
- [ ] Write panel tests first. Cover caller ID/contact confirmation, microphone setup, device selectors, explicit **Call now**, status and timer, mute, keypad digits, speaker fallback messaging, hangup, completed/failed states, and keyboard-accessible labels.
- [ ] Run both focused component tests and confirm they fail.

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/calls/phone-actions.test.tsx src/components/calls/computer-call-panel.test.tsx
```

- [ ] Implement a focused panel that receives the selected contact/phone context and owns `useComputerCall`. Keep the number masked in the normal UI, show the configured work caller ID, and require the final button click after setup.
- [ ] Update `PhoneActions` to preserve copy and voicemail behavior while relabeling the current primary `tel:` action to **Call with Phone Link** whenever computer calling is available.
- [ ] Update workspace tests first for lifecycle linkage. Assert that a connected browser call sets `startedAt`, `method = "browser_voip"`, and `requestKey = sessionId`; assert completion uses the technical `endedAt` rather than a fresh submission time; assert notes/outcome remain required by the existing flow.

```ts
expect(completeCall).toHaveBeenCalledWith(expect.objectContaining({
  requestKey: "computer-session-id",
  method: "browser_voip",
  startedAt: "2026-09-01T10:00:00.000Z",
  endedAt: "2026-09-01T10:03:15.000Z",
}));
```

- [ ] Implement workspace/page wiring and retain the original random request key for non-browser methods. Prevent changing the selected phone while a computer call is active. If the outcome submission fails, retain the session ID and entered notes for retry.
- [ ] Run all affected frontend and backend tests.

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/calls/phone-actions.test.tsx src/components/calls/computer-call-panel.test.tsx src/components/calls/call-workspace.test.tsx src/pages/CallWorkspacePage.test.tsx
pnpm --filter @workspace/api-server exec vitest run src/features/calls/call-service.test.ts src/routes/calls.test.ts
```

- [ ] Commit the task.

```bash
git add artifacts/adventure-zone/src/components/calls/computer-call-panel.tsx artifacts/adventure-zone/src/components/calls/computer-call-panel.test.tsx artifacts/adventure-zone/src/components/calls/phone-actions.tsx artifacts/adventure-zone/src/components/calls/phone-actions.test.tsx artifacts/adventure-zone/src/components/calls/call-workspace.tsx artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx artifacts/adventure-zone/src/pages/CallWorkspacePage.test.tsx artifacts/adventure-zone/src/features/calls/call-types.ts artifacts/adventure-zone/src/actions/calls.ts artifacts/api-server/src/features/calls/call-types.ts artifacts/api-server/src/features/calls/call-input.ts artifacts/api-server/src/features/calls/call-service.test.ts
git commit -m "feat(ui): add computer calling workspace controls"
```

---

## Task 8: Document deployment, verify the full system, and keep rollout disabled

**Files:**

- Modify: `render.yaml`
- Modify: `DEPLOY.md`
- Modify as required by formatter/typecheck only: files changed in Tasks 1–7

**Interfaces:**

- Adds deployment configuration for all eight Twilio variables with the feature disabled by default.
- Documents Twilio account, API key, TwiML App, verified caller ID, webhook, browser permission, controlled call, rollback, and privacy checks.
- Produces a green automated verification record without placing a real call.

- [ ] Add Render environment entries. Set `TWILIO_VOICE_ENABLED` to `false`; mark credential values `sync: false`; do not commit live values.

```yaml
- key: TWILIO_VOICE_ENABLED
  value: "false"
- key: TWILIO_ACCOUNT_SID
  sync: false
- key: TWILIO_API_KEY_SID
  sync: false
- key: TWILIO_API_KEY_SECRET
  sync: false
- key: TWILIO_AUTH_TOKEN
  sync: false
- key: TWILIO_TWIML_APP_SID
  sync: false
- key: TWILIO_VERIFIED_CALLER_ID
  sync: false
- key: TWILIO_WEBHOOK_BASE_URL
  sync: false
```

- [ ] Add a deployment runbook to `DEPLOY.md` in this order: obtain Twilio credentials; verify the existing work number for outbound caller ID; create a TwiML App pointing to `/webhooks/twilio/voice/outbound`; configure the public HTTPS base URL; deploy with the flag false; run smoke checks; enable for a controlled test; call a consenting internal/test recipient; verify caller ID; verify mute/keypad/hangup and outcome logging; call back and confirm the physical work phone rings; verify Twilio recording is disabled; roll back by setting the flag false.
- [ ] Document that trial accounts may only call verified recipient numbers and that emergency calling is not supported by this feature.
- [ ] Run every focused suite introduced or changed by the plan.

```bash
pnpm --filter @workspace/api-server exec vitest run src/features/calls/computer-calling-config.test.ts src/features/calls/nanp-phone.test.ts src/features/calls/computer-call-repository.test.ts src/features/calls/computer-calling-service.test.ts src/features/calls/twilio-computer-voice-provider.test.ts src/features/calls/computer-calling-rate-limit.test.ts src/routes/computer-calling.test.ts src/routes/twilio-voice-webhooks.test.ts src/routes/calls.test.ts src/db/computer-calling-required-startup.test.ts src/db/required-schema-startup.test.ts src/features/calls/call-service.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/hooks/use-computer-call.test.tsx src/components/calls/phone-actions.test.tsx src/components/calls/computer-call-panel.test.tsx src/components/calls/call-workspace.test.tsx src/pages/CallWorkspacePage.test.tsx
```

- [ ] Run repository-wide typechecking and production builds.

```bash
pnpm typecheck
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/adventure-zone run build
```

- [ ] Inspect the final diff for secrets, raw phone logging, recording options, accidental inbound handling, and any bypass that accepts a browser-provided destination.

```bash
git diff --check
git grep -nE 'TWILIO_(API_KEY_SECRET|AUTH_TOKEN)=|recording|recordings|destination:' -- ':!docs/superpowers' ':!DEPLOY.md'
```

- [ ] Confirm the deployed config endpoint reports `computerCalling.enabled: false` until the operator intentionally enables it. Do not place a real call as part of this plan execution.
- [ ] Commit the deployment and verification documentation.

```bash
git add render.yaml DEPLOY.md
git commit -m "docs: add Twilio computer calling rollout runbook"
```

---

## Acceptance Checklist

- [ ] A stored, eligible contact phone can be called from the browser only after microphone setup and an explicit **Call now** confirmation.
- [ ] The remote recipient sees the configured verified Adventure Zone work number.
- [ ] Calling the work number still rings the physical work phone; no inbound browser routing exists.
- [ ] Phone Link remains available as a fallback.
- [ ] DNC, suppression, context mismatch, invalid phone, expired intent, and reused intent paths fail closed.
- [ ] Twilio webhooks reject invalid signatures and accept idempotent retries from the same `CallSid`.
- [ ] Browser tokens, credentials, media, recordings, transcripts, raw webhooks, and device labels are not persisted.
- [ ] Mute, keypad, microphone selection, supported speaker selection, hangup, state display, and timer work without changing the existing notes/outcome workflow.
- [ ] The technical call session links to the business call through `call_sessions.request_key = computer_call_sessions.id` for `browser_voip` calls.
- [ ] All focused tests, repository typecheck, and both production builds pass.
- [ ] Rollout remains disabled until valid Twilio credentials and a controlled manual test are available.
