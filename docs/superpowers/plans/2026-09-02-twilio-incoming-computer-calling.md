# Twilio Incoming Computer Calling and Voicemail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one authorized Command Center browser receive Verizon-forwarded calls through the purchased Twilio number, answer with computer audio, and manage unrecorded conversations or two-minute voicemail messages in a private inbox.

**Architecture:** Build inbound calling beside the outbound-only implementation: isolated inbound tables and services, a renewable owner-scoped browser lease, signed Twilio webhooks, a provider-neutral Voice SDK adapter, and authenticated voicemail media proxying. The server remains authoritative for the current browser identity, caller matching, provider state, media deletion, and callback eligibility; the browser owns only presentation and explicit answer/reject actions.

**Tech Stack:** TypeScript, Express 5, Drizzle/PostgreSQL, Twilio Node SDK, Twilio Voice JavaScript SDK, React 19, Wouter, TanStack Query, Vitest, Testing Library, pnpm, Render.

**Spec:** `docs/superpowers/specs/2026-09-02-twilio-incoming-computer-calling-design.md`

## Global Constraints

- Implement from the merged outbound computer-calling work, or rebase onto its final merge commit before Task 1. Do not expand or rewrite the outbound pull request.
- Keep `computer_call_sessions` outbound-only and retain its required organization, contact, and phone constraints.
- Keep `TWILIO_VOICE_ENABLED` and `TWILIO_INBOUND_VOICE_ENABLED` independent. Every inbound server route and browser control fails closed unless assisted calling and inbound calling are both enabled and fully configured.
- Keep the Verizon number as `TWILIO_VERIFIED_CALLER_ID`; use `TWILIO_INBOUND_NUMBER` only as the Twilio ingress number and manual forwarding destination.
- Never automate `*72` or `*73`, infer forwarding state, dial the Verizon number as an inbound fallback, place a real call, create a real recording, or change a Twilio/Verizon account in automated tests.
- Never record an answered browser call or transcribe any audio. Store recording SIDs, not provider media URLs.
- Validate every public Twilio request before reading or mutating state, using the exact webhook URL and complete form field map. Require signed `To` to equal the configured inbound number.
- Treat `From` only as caller-matching input. Ambiguous, malformed, or absent caller IDs remain unknown and never become callback destinations.
- Use a Standard Twilio API key for Voice token generation and recording media operations. Use the Account Auth Token only for webhook signature validation.
- Use fake clocks, fake schedulers, provider fakes, and browser adapter fakes in tests. No test may depend on Twilio, Verizon, browser notification servers, or wall-clock sleeps.
- After each task, run the named focused tests, `git diff --check`, and commit only that task's files.

---

## Task 1: Add fail-closed inbound configuration and Voice provider contracts

**Files:**

- Create: `artifacts/api-server/src/features/calls/inbound-calling-config.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-calling-config.test.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-voice-provider.ts`
- Modify: `artifacts/api-server/src/features/calls/computer-voice-provider.ts`
- Modify: `artifacts/api-server/src/features/calls/twilio-computer-voice-provider.ts`
- Modify: `artifacts/api-server/src/features/calls/twilio-computer-voice-provider.test.ts`
- Modify: `artifacts/api-server/src/features/calls/computer-calling-types.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Modify: `artifacts/api-server/src/routes/calls.test.ts`

- [ ] Write failing configuration tests for the default-disabled state, incomplete configuration, E.164 ingress validation, integer retention/max-seconds bounds, and redacted capability output.

  ```ts
  expect(readInboundCallingConfig({}).capability).toEqual({
    enabled: false,
    reason: "disabled",
    inboundNumberDisplay: null,
    retentionDays: 30,
    maxSeconds: 120,
  });
  ```

- [ ] Run `pnpm --filter @workspace/api-server exec vitest run src/features/calls/inbound-calling-config.test.ts` and confirm the new tests fail for missing implementation.
- [ ] Implement `readInboundCallingConfig(env)` with these server-only inputs: `TWILIO_INBOUND_VOICE_ENABLED`, `TWILIO_INBOUND_NUMBER`, `TWILIO_VOICEMAIL_RETENTION_DAYS`, and `TWILIO_VOICEMAIL_MAX_SECONDS`. Reuse the already validated account SID, Standard API key SID/secret, Auth Token, TwiML App SID, verified caller ID, and webhook base URL from `readComputerCallingConfig` without returning their values to the browser.
- [ ] Define provider-neutral inbound contracts in `inbound-voice-provider.ts`:

  ```ts
  export type InboundVoiceProvider = {
    createBrowserToken(input: {
      identity: string;
      ttlSeconds: number;
      allowIncoming: boolean;
    }): Promise<{ token: string; expiresAt: Date }>;
    validateWebhook(input: SignedWebhookInput): boolean;
    createClientDialTwiml(input: InboundClientDialInput): string;
    createVoicemailTwiml(input: VoicemailTwimlInput): string;
    createUnavailableTwiml(): string;
    getRecordingMedia(recordingSid: string): Promise<ProviderRecordingMedia>;
    deleteRecording(
      recordingSid: string,
    ): Promise<"deleted" | "already_absent">;
  };
  ```

- [ ] Extend the existing Twilio provider so Voice grants set `incomingAllow: true` only for lease-bound inbound tokens, retain the outgoing application SID when outbound is enabled, and never accept an identity from an HTTP body. Add tests that inspect the decoded grant payload for the incoming flag and opaque identity.
- [ ] Add `inboundCalling` to `/calls/config`, exposing only readiness state, masked number display, max message length, and retention days. Add route tests proving disabled and incomplete configurations reveal missing variable names but no values.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/inbound-calling-config.test.ts \
    src/features/calls/twilio-computer-voice-provider.test.ts \
    src/routes/calls.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: add inbound voice configuration contracts`

## Task 2: Add isolated inbound call, lease, and voicemail persistence

**Files:**

- Create: `lib/db/migrations/20260902_twilio_incoming_computer_calling.sql`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/src/db/inbound-calling-required-startup.ts`
- Create: `artifacts/api-server/src/db/inbound-calling-required-startup.test.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.ts`
- Modify: `artifacts/api-server/src/db/required-schema-startup.test.ts`

- [ ] Write failing startup tests that assert creation of `incoming_call_availability_leases`, `inbound_call_sessions`, and `inbound_voicemails`, plus the nullable `call_sessions.inbound_technical_session_id` foreign key.
- [ ] Define `incoming_call_availability_leases` with one row per `owner_id`, a random opaque `client_identity`, `lease_token_hash`, `browser_session_id`, `expires_at`, `heartbeat_at`, `active_inbound_session_id`, and timestamps. Add unique indexes for `owner_id` and `client_identity`; never persist the plaintext lease token.
- [ ] Define `inbound_call_sessions` with unique `provider_parent_call_sid`, optional unique browser child SID, owner ID, provider/method/direction checks, ingress/caller snapshots, optional organization/contact/phone FKs, monotonic technical status, browser result, timestamps, and sanitized error fields.
- [ ] Define `inbound_voicemails` with unique inbound-session and recording SID constraints; processing/available/handled/deletion-pending/audio-deleted/failed states; duration/content type; retention deadline; handled identity/time; optional explicitly linked profile/phone; provider deletion attempt metadata; and a nullable business call-session link.
- [ ] Preserve `computer_call_sessions` exactly. Add only a nullable inbound technical-session FK to the general `call_sessions` table, with a unique partial index so one business outcome cannot be attached to multiple copies of the same inbound call.
- [ ] Mirror the migration in `lib/db/src/schema/index.ts` and implement idempotent pre-listen schema startup following `computer-calling-required-startup.ts`.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/db/inbound-calling-required-startup.test.ts \
    src/db/required-schema-startup.test.ts
  pnpm --filter @workspace/db run build
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: add inbound calling persistence`

## Task 3: Implement the authoritative availability lease

**Files:**

- Create: `artifacts/api-server/src/features/calls/incoming-availability-types.ts`
- Create: `artifacts/api-server/src/features/calls/incoming-availability-repository.ts`
- Create: `artifacts/api-server/src/features/calls/incoming-availability-repository.test.ts`
- Create: `artifacts/api-server/src/features/calls/incoming-availability-service.ts`
- Create: `artifacts/api-server/src/features/calls/incoming-availability-service.test.ts`
- Modify: `artifacts/api-server/src/features/calls/computer-calling-service.ts`
- Modify: `artifacts/api-server/src/features/calls/computer-calling-service.test.ts`

- [ ] Write repository tests for atomic acquisition, renewal by hashed secret, expiry, release, identity lookup, and takeover. Prove a takeover fails while `active_inbound_session_id` is set and that simultaneous acquisitions leave exactly one current identity.
- [ ] Implement a repository transaction using row locking/upsert semantics. Generate the opaque client identity and lease secret server-side; return the plaintext secret once, persist only its SHA-256 hash, and compare hashes in constant time.
- [ ] Implement `IncomingAvailabilityService` with an injected clock and random source:

  ```ts
  type IncomingAvailabilityService = {
    acquire(input: {
      ownerId: string;
      browserSessionId: string;
    }): Promise<LeaseResult>;
    renew(input: {
      ownerId: string;
      leaseId: string;
      leaseSecret: string;
    }): Promise<LeaseResult>;
    release(input: {
      ownerId: string;
      leaseId: string;
      leaseSecret: string;
    }): Promise<void>;
    takeover(input: {
      ownerId: string;
      browserSessionId: string;
    }): Promise<LeaseResult>;
    resolveCurrent(ownerId: string): Promise<ResolvedLease | null>;
    resolveIdentity(clientIdentity: string): Promise<ResolvedLease | null>;
  };
  ```

- [ ] Use a 45-second lease with a 15-second heartbeat cadence and make the values named constants so fake-clock tests cover the boundary exactly.
- [ ] Change outbound TwiML intent consumption to resolve the lease identity to the stable owner ID before calling `consumeIntent`. Keep legacy owner tokens valid only when inbound is disabled; never compare an opaque client identity directly to `computer_call_sessions.owner_id`.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/incoming-availability-repository.test.ts \
    src/features/calls/incoming-availability-service.test.ts \
    src/features/calls/computer-calling-service.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: enforce one incoming browser lease`

## Task 4: Persist inbound sessions and match callers safely

**Files:**

- Create: `artifacts/api-server/src/features/calls/inbound-call-types.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-call-repository.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-call-repository.test.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-caller-matcher.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-caller-matcher.test.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-call-service.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-call-service.test.ts`

- [ ] Write caller-matching tests for one normalized contact-phone match, no match, malformed/private caller ID, and multiple matches. Assert only one unambiguous stored phone produces profile IDs.
- [ ] Write repository tests for idempotent parent Call SID creation, browser child SID attachment, monotonic status updates, explicit voicemail requests, answered timestamps, and terminal-state non-regression under duplicate/out-of-order callbacks.
- [ ] Implement matching with the existing NANP normalizer and `contact_phones`; do not fall back to fuzzy name, organization main number, or raw caller strings.
- [ ] Implement `InboundCallService` so `begin` snapshots the configured ingress number and caller number, `markBrowserDial` attaches the lease/session, `requestVoicemail` is owner-scoped and idempotent, and `applyProviderEvent` sanitizes errors before persistence.
- [ ] Define the voicemail transition predicate in one tested pure function: only never-connected `busy`, `no-answer`, `failed`, provider rejection, or an explicit pre-answer voicemail request may enter voicemail. `completed` after `answered_at` always terminates without voicemail.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/inbound-caller-matcher.test.ts \
    src/features/calls/inbound-call-repository.test.ts \
    src/features/calls/inbound-call-service.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: track inbound calls and match callers`

## Task 5: Generate safe inbound and voicemail TwiML

**Files:**

- Modify: `artifacts/api-server/src/features/calls/inbound-voice-provider.ts`
- Modify: `artifacts/api-server/src/features/calls/twilio-computer-voice-provider.ts`
- Modify: `artifacts/api-server/src/features/calls/twilio-computer-voice-provider.test.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-voice-twiml.test.ts`

- [ ] Write failing TwiML tests that parse XML and assert the inbound response dials only one server-resolved `<Client>` identity, uses a 25-second timeout and signed action/status callback paths, and contains no `record` attribute on `<Dial>`.
- [ ] Write voicemail TwiML tests for the exact approved greeting—“You've reached The Adventure Zone. We can't answer right now. Please leave your name, event, phone number, and a brief message after the beep.”—plus `<Record maxLength="120" playBeep="true" transcribe="false">`, action/status callbacks, and a thank-you message. Assert no voicemail TwiML is generated after an answered timestamp exists.
- [ ] Implement provider methods using Twilio's TwiML builders. Pass callback URLs assembled from validated `TWILIO_WEBHOOK_BASE_URL`; never accept callback URLs or client identities from webhook form data.
- [ ] Implement a safe temporary-problem TwiML response that speaks a short retry-later message and hangs up without `<Record>`; use it whenever inbound is disabled/incomplete or no safe persistence path exists.
- [ ] Add provider media methods that address recordings by validated `RE...` SID, return a narrow `audio/mpeg` or `audio/wav` stream, delete by SID, and normalize Twilio 404 as `already_absent` without logging credentials or media URLs.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/inbound-voice-twiml.test.ts \
    src/features/calls/twilio-computer-voice-provider.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: generate inbound call and voicemail TwiML`

## Task 6: Add signed public Twilio inbound webhooks

**Files:**

- Create: `artifacts/api-server/src/routes/twilio-inbound-voice-webhooks.ts`
- Create: `artifacts/api-server/src/routes/twilio-inbound-voice-webhooks.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/routes/index.test.ts`

- [ ] Build the test router with fake config, provider, lease, inbound-call, and voicemail services. First write tests proving every endpoint rejects missing/invalid signatures before a service call and rejects a signed request whose `To` does not equal `TWILIO_INBOUND_NUMBER`.
- [ ] Add `POST /webhooks/twilio/voice/inbound`: validate signature and `To`, idempotently begin the parent session, match `From`, resolve the current lease, and return either one-client dial TwiML or the voicemail flow when no browser is available.
- [ ] Add `POST /webhooks/twilio/voice/inbound/dial-result`: apply `DialCallStatus` idempotently and return empty hangup TwiML for an answered/completed call or voicemail TwiML only through the tested never-connected transition predicate.
- [ ] Add signed parent/browser status callbacks that store normalized monotonic status and child Call SID without allowing an out-of-order event to regress `answered` or `completed`.
- [ ] Add signed voicemail action and recording-status callbacks. Key mutations by parent Call SID plus event purpose, validate recording SID format, create one processing record, then mark it available with duration/content type and `retention_deadline = completed_at + configured days`.
- [ ] Ensure all error responses are generic XML or empty responses, use redacted logging, and never persist the full webhook body. Mount the public router before `requireOwnerMiddleware`, beside the outbound webhook router.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/routes/twilio-inbound-voice-webhooks.test.ts \
    src/routes/index.test.ts \
    src/routes/twilio-voice-webhooks.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: handle signed inbound Twilio webhooks`

## Task 7: Add authenticated availability, history, and voicemail APIs

**Files:**

- Create: `artifacts/api-server/src/features/calls/inbound-voicemail-types.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-voicemail-repository.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-voicemail-repository.test.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-voicemail-service.ts`
- Create: `artifacts/api-server/src/features/calls/inbound-voicemail-service.test.ts`
- Create: `artifacts/api-server/src/routes/inbound-computer-calling.ts`
- Create: `artifacts/api-server/src/routes/inbound-computer-calling.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

- [ ] Write route tests proving owner authentication, feature gating, rate limits, lease acquire/renew/release/takeover ownership, and token issuance only for the returned current lease identity.
- [ ] Add owner routes under `/calls/computer/inbound` for capability, lease lifecycle, token refresh, session list/detail, and explicit pre-answer send-to-voicemail. Return `409` for active-call takeover and stale lease operations.
- [ ] Add voicemail list/detail/handled/link/delete/playback routes. Require UUIDs and strict request schemas, scope every query by owner ID, and use cursor pagination for list responses.
- [ ] Implement explicit linking as an auditable update: accept only existing organization/contact/contact-phone IDs that are relationally consistent. Never create a profile or phone record from the voicemail route.
- [ ] Expose `callbackEligible` only when a linked stored phone passes the existing outbound phone-context, suppression, and Do Not Call checks. The callback button must invoke the unchanged outbound intent API with stored IDs, never the caller-number snapshot.
- [ ] Implement authenticated media proxying by internal voicemail ID. Stream provider media with `Content-Type: audio/mpeg`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, no redirect, and no provider URL or recording SID in the response.
- [ ] On user delete, immediately deny future playback, set deletion pending, call the provider by recording SID, and mark audio deleted only after `deleted` or `already_absent`. Preserve inbound metadata, linkage, business notes, and safe deletion error state for retry.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/inbound-voicemail-repository.test.ts \
    src/features/calls/inbound-voicemail-service.test.ts \
    src/routes/inbound-computer-calling.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: add private inbound calling APIs`

## Task 8: Add idempotent voicemail retention cleanup

**Files:**

- Create: `artifacts/api-server/src/features/calls/voicemail-retention-worker.ts`
- Create: `artifacts/api-server/src/features/calls/voicemail-retention-worker.test.ts`
- Create: `artifacts/api-server/src/features/calls/voicemail-retention-worker-loop.ts`
- Create: `artifacts/api-server/src/features/calls/voicemail-retention-worker-loop.test.ts`
- Modify: `artifacts/api-server/src/index.ts`
- Modify: `artifacts/api-server/src/index.startup-order.test.ts`

- [ ] Write worker tests with a fake clock/provider for due selection, successful deletion, provider 404, bounded transient retry state, permanent failure metadata, and concurrent workers claiming each voicemail once.
- [ ] Implement a repository claim using `FOR UPDATE SKIP LOCKED` (or the project's equivalent atomic claim pattern), with a bounded batch and lease timeout so a crashed worker can be retried.
- [ ] Implement a loop with an injected scheduler, immediate first pass, 15-minute cadence, error isolation, and `close()` cleanup. Run only when inbound configuration is enabled; disabled deployments must not call Twilio.
- [ ] Wire the loop into `startBackgroundWorkers()` and graceful shutdown. Preserve startup ordering: schema before listen, retention loop only after listen/background-worker startup.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/voicemail-retention-worker.test.ts \
    src/features/calls/voicemail-retention-worker-loop.test.ts \
    src/index.startup-order.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: expire Twilio voicemail audio`

## Task 9: Extend the browser Voice adapter for registration and incoming calls

**Files:**

- Modify: `artifacts/adventure-zone/src/features/calls/computer-calling-types.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/computer-calling-api.ts`
- Modify: `artifacts/adventure-zone/src/features/calls/twilio-browser-device.ts`
- Create: `artifacts/adventure-zone/src/features/calls/twilio-browser-device.test.ts`
- Create: `artifacts/adventure-zone/src/features/calls/incoming-calling-api.ts`
- Create: `artifacts/adventure-zone/src/features/calls/incoming-calling-api.test.ts`

- [ ] Write adapter tests for `register`, `registered`, `unregistered`, `tokenWillExpire`, incoming call delivery, `accept`, `reject`, disconnect, error, listener teardown, and repeated token updates without duplicate listeners.
- [ ] Extend the provider-neutral interfaces:

  ```ts
  export type BrowserIncomingCall = {
    parameters: Readonly<Record<string, string>>;
    accept(): Promise<void>;
    reject(): void;
    disconnect(): void;
    mute(value: boolean): void;
    sendDigits(value: string): void;
    on(
      event: "accept" | "disconnect" | "cancel" | "error",
      listener: (...args: any[]) => void,
    ): void;
  };
  ```

- [ ] Add `register()`, `unregister()`, `updateToken()`, registration events, and incoming call events to `TwilioBrowserDevice`. Keep the Twilio SDK import confined to this adapter and remove all listeners before `destroy()`.
- [ ] Implement `incoming-calling-api.ts` for capability, lease lifecycle, token refresh, explicit voicemail request, inbound session reads, inbox mutations, and authenticated media URL construction using internal IDs only.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/adventure-zone exec vitest run \
    src/features/calls/twilio-browser-device.test.ts \
    src/features/calls/incoming-calling-api.test.ts
  pnpm --filter @workspace/adventure-zone run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: support incoming browser voice events`

## Task 10: Build global availability, lease coordination, and private notifications

**Files:**

- Create: `artifacts/adventure-zone/src/features/calls/incoming-notifications.ts`
- Create: `artifacts/adventure-zone/src/features/calls/incoming-notifications.test.ts`
- Create: `artifacts/adventure-zone/src/features/calls/incoming-tab-coordinator.ts`
- Create: `artifacts/adventure-zone/src/features/calls/incoming-tab-coordinator.test.ts`
- Create: `artifacts/adventure-zone/src/hooks/use-incoming-call-availability.ts`
- Create: `artifacts/adventure-zone/src/hooks/use-incoming-call-availability.test.tsx`
- Create: `artifacts/adventure-zone/src/features/calls/incoming-calling-context.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/incoming-availability-control.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/incoming-availability-control.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.test.tsx`

- [ ] Write reducer/hook tests for `off`, media check, registration, ready, reconnecting, and unavailable; lease heartbeat/expiry; token refresh; stale response suppression; turn-off cleanup; and takeover conflicts.
- [ ] Implement a `BroadcastChannel` coordinator with a storage-event fallback. Use it only to warn/coordinate local tabs; always acquire/renew against the server before registering the device.
- [ ] Implement notification permission and display behind a small adapter. Default body text to `Incoming Adventure Zone call`; notification clicks call `window.focus()` and reveal the in-app panel but never invoke `accept()`.
- [ ] Implement `IncomingCallingProvider` at the authenticated `AppShell` level so registration persists across route changes while the tab remains open. Keep lease secret, Voice token, client identity, device labels, and forwarding acknowledgements in memory/local UI state as appropriate; never put credentials in local storage.
- [ ] Add the global availability control with explicit `*72 + Twilio number` instructions after Ready and a persistent `*73` reminder after availability is turned off. Store only the user's reminder acknowledgement; label it as manual confirmation and never as verified carrier state.
- [ ] Block takeover while either server or local state reports an active call. Add `beforeunload` warning while a call is active or the `*73` reminder remains unacknowledged.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/adventure-zone exec vitest run \
    src/features/calls/incoming-notifications.test.ts \
    src/features/calls/incoming-tab-coordinator.test.ts \
    src/hooks/use-incoming-call-availability.test.tsx \
    src/components/calls/incoming-availability-control.test.tsx \
    src/components/navigation/app-shell.test.tsx
  pnpm --filter @workspace/adventure-zone run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: manage incoming call availability`

## Task 11: Add the incoming call panel and inbound Call Workspace mode

**Files:**

- Create: `artifacts/adventure-zone/src/hooks/use-incoming-call.ts`
- Create: `artifacts/adventure-zone/src/hooks/use-incoming-call.test.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/incoming-call-panel.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/incoming-call-panel.test.tsx`
- Modify: `artifacts/adventure-zone/src/features/calls/incoming-calling-context.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.tsx`
- Modify: `artifacts/adventure-zone/src/pages/CallWorkspacePage.test.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- Modify: `artifacts/adventure-zone/src/components/calls/call-workspace.test.tsx`
- Modify: `artifacts/api-server/src/features/calls/call-workspace-query.ts`
- Modify: `artifacts/api-server/src/features/calls/call-workspace-query.test.ts`
- Modify: `artifacts/api-server/src/routes/calls.ts`
- Modify: `artifacts/api-server/src/routes/calls.test.ts`

- [ ] Write incoming state tests for ringing, explicit answer, explicit send-to-voicemail, remote cancel, timeout, connection error, hangup, and browser disconnect after answer. Assert no post-answer state can enter voicemail.
- [ ] Implement the global panel over any route. Read only the server-issued inbound session ID from Twilio call parameters, then load caller display data from the authenticated API; ignore contact names, profile IDs, and numbers in SDK parameters.
- [ ] On **Answer**, call the SDK accept method exactly once and navigate to `/calls/workspace?inboundSessionId=<uuid>` after acceptance. On **Send to voicemail**, first mark the session through the authenticated API, then reject the browser leg; retry safely without double transitions.
- [ ] Extend the server workspace query to accept an owner-scoped inbound session ID. For a matched/linked caller, load the existing contact/organization context and use `incoming_inquiry` scripts; for unknown callers, return a minimal inbound context with callback disabled and no automatic profile mutation.
- [ ] Extend `CallWorkspace` with an explicit `direction: "outgoing" | "incoming"` prop and inbound technical metadata. Reuse timer, mute, keypad, audio selection, hangup, notes, outcomes, and follow-up components while hiding outbound start-call/Phone Link controls in inbound mode.
- [ ] Make business outcome submission idempotent using the inbound technical session ID as the request key. Require an explicit stored profile/phone link before creating a general `call_sessions` row for an unknown caller; otherwise retain technical history and allow linking first.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/adventure-zone exec vitest run \
    src/hooks/use-incoming-call.test.tsx \
    src/components/calls/incoming-call-panel.test.tsx \
    src/pages/CallWorkspacePage.test.tsx \
    src/components/calls/call-workspace.test.tsx
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/call-workspace-query.test.ts \
    src/routes/calls.test.ts
  pnpm --filter @workspace/adventure-zone run typecheck
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: answer inbound calls in call workspace`

## Task 12: Build the authenticated voicemail inbox

**Files:**

- Create: `artifacts/adventure-zone/src/pages/VoicemailInboxPage.tsx`
- Create: `artifacts/adventure-zone/src/pages/VoicemailInboxPage.test.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/voicemail-card.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/voicemail-card.test.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/private-audio-player.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/private-audio-player.test.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/link-inbound-caller-dialog.tsx`
- Create: `artifacts/adventure-zone/src/components/calls/link-inbound-caller-dialog.test.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: `artifacts/adventure-zone/src/components/navigation/app-menu.tsx`
- Create: `artifacts/adventure-zone/src/components/navigation/app-menu.test.tsx`

- [ ] Write page/card tests for new/handled counts, matched/unknown display, processing, playable, deletion-pending, audio-deleted, and provider-failed states. Test empty, loading, pagination, API error, and keyboard-accessible actions.
- [ ] Implement `/calls/voicemail` with cursor pagination and explicit filters for new/handled. Add **Voicemail** next to **Calls** in the booking tools menus without changing unrelated navigation.
- [ ] Build the audio player against the authenticated internal playback route. Revoke object URLs on replacement/unmount, prevent browser caching, and show metadata-only states when processing or deleted.
- [ ] Implement **Open profile**, **Add note**, **Link profile**, **Mark handled**, and **Delete audio** actions according to API capability fields. Require confirmation for deletion and explain that call history/notes remain.
- [ ] Implement **Call back** by passing only the linked stored organization/contact/phone IDs into the existing outbound Call Workspace. Keep it disabled with a reason for unknown, suppressed, or Do Not Call numbers; never copy the inbound caller snapshot into a dial request.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/adventure-zone exec vitest run \
    src/pages/VoicemailInboxPage.test.tsx \
    src/components/calls/voicemail-card.test.tsx \
    src/components/calls/private-audio-player.test.tsx \
    src/components/calls/link-inbound-caller-dialog.test.tsx \
    src/components/navigation/app-menu.test.tsx
  pnpm --filter @workspace/adventure-zone run typecheck
  git diff --check
  ```

- [ ] Commit: `feat: add private voicemail inbox`

## Task 13: Document secure Twilio setup and controlled Verizon rollout

**Files:**

- Modify: `render.yaml`
- Modify: `DEPLOY.md`
- Create: `docs/operations/twilio-incoming-calling-rollout.md`
- Create: `docs/operations/twilio-incoming-calling-rollback.md`
- Create: `artifacts/api-server/src/features/calls/inbound-deployment-config.test.ts`

- [ ] Write a source-level deployment test asserting Render declares the four inbound variables, both flags default false, no secret has a committed value, the inbound and outbound webhook paths are different, and documentation requires a Standard—not Restricted—API key.
- [ ] Add Render variables with safe defaults:

  ```yaml
  - key: TWILIO_INBOUND_VOICE_ENABLED
    value: "false"
  - key: TWILIO_INBOUND_NUMBER
    sync: false
  - key: TWILIO_VOICEMAIL_RETENTION_DAYS
    value: "30"
  - key: TWILIO_VOICEMAIL_MAX_SECONDS
    value: "120"
  ```

- [ ] Update `DEPLOY.md` to separate the TwiML App outbound URL from the purchased number's inbound URL. Correct any older Restricted-key guidance to Standard API key guidance. Document the static fallback URL requirement and the no-recording/no-transcription guarantees.
- [ ] Write the rollout runbook in this exact order: deploy both flags false; configure Twilio; enable inbound for a controlled test; call the Twilio number directly; verify matched and unknown callers, background ringing, answer, voicemail, playback, deletion, closed-browser, token refresh, and multi-tab behavior; only then dial `*72` from Verizon; call the work number from an owned/consenting phone; verify original caller ID preservation and two-way audio; test unanswered voicemail; dial `*73`; confirm the physical Verizon phone rings again.
- [ ] Write a one-page rollback card whose first action is `*73`, followed by disabling `TWILIO_INBOUND_VOICE_ENABLED`, confirming browser unregistration, leaving the safe static fallback, and preserving only non-sensitive diagnostic metadata.
- [ ] Run:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run src/features/calls/inbound-deployment-config.test.ts
  pnpm --filter @workspace/api-server run typecheck
  git diff --check
  ```

- [ ] Commit: `docs: add inbound calling rollout controls`

## Task 14: Run full verification and prepare the separate review

**Files:**

- Modify only files required to fix failures attributable to Tasks 1–13.

- [ ] Confirm the branch contains the final merged outbound implementation and that the diff does not alter `computer_call_sessions` constraints or enable either Twilio flag by default.
- [ ] Run all focused incoming suites together:

  ```bash
  pnpm --filter @workspace/api-server exec vitest run \
    src/features/calls/inbound-calling-config.test.ts \
    src/features/calls/incoming-availability-repository.test.ts \
    src/features/calls/incoming-availability-service.test.ts \
    src/features/calls/inbound-caller-matcher.test.ts \
    src/features/calls/inbound-call-repository.test.ts \
    src/features/calls/inbound-call-service.test.ts \
    src/features/calls/inbound-voice-twiml.test.ts \
    src/features/calls/inbound-voicemail-repository.test.ts \
    src/features/calls/inbound-voicemail-service.test.ts \
    src/features/calls/voicemail-retention-worker.test.ts \
    src/routes/twilio-inbound-voice-webhooks.test.ts \
    src/routes/inbound-computer-calling.test.ts
  pnpm --filter @workspace/adventure-zone exec vitest run \
    src/features/calls/twilio-browser-device.test.ts \
    src/features/calls/incoming-calling-api.test.ts \
    src/features/calls/incoming-notifications.test.ts \
    src/features/calls/incoming-tab-coordinator.test.ts \
    src/hooks/use-incoming-call-availability.test.tsx \
    src/hooks/use-incoming-call.test.tsx \
    src/components/calls/incoming-availability-control.test.tsx \
    src/components/calls/incoming-call-panel.test.tsx \
    src/pages/CallWorkspacePage.test.tsx \
    src/pages/VoicemailInboxPage.test.tsx
  ```

- [ ] Run repository-wide verification:

  ```bash
  pnpm --filter @workspace/api-server test
  pnpm --filter @workspace/api-server run typecheck
  pnpm --filter @workspace/adventure-zone exec vitest run
  pnpm --filter @workspace/adventure-zone run typecheck
  pnpm --filter @workspace/db run build
  pnpm run build
  git diff --check
  git status --short
  ```

- [ ] Inspect generated TwiML fixtures and route responses to prove answered `<Dial>` has no recording, voicemail has no transcription, authenticated playback never exposes a Twilio URL/SID, and disabled configuration produces the safe no-recording fallback.
- [ ] Review logs from automated tests for access tokens, Auth Tokens, API secrets, recording URLs/SIDs, raw webhook maps, and full caller numbers; fail the review if any appear.
- [ ] Prepare the pull request as a separate inbound feature. Include schema/rollback notes, both feature flags, direct-number acceptance checklist, the later Verizon `*72`/`*73` test, and an explicit statement that no automated test placed a call or created a recording.
- [ ] Commit any verification-only fixes with a precise message; if no files changed, do not create an empty commit.
