# Twilio Computer Calling Design

Date: 2026-09-01  
Status: Approved design  
Repository: `epivene/adventure-zone-command-center`

## Summary

Add outbound live computer calling to the existing guided Call Workspace using Twilio Programmable Voice and the Twilio Voice JavaScript SDK.

The user speaks and listens through the computer. The recipient sees the existing Adventure Zone work number as caller ID after that number is verified with Twilio. The existing work phone and carrier remain unchanged, and incoming calls and callbacks continue to ring the physical work phone.

This design intentionally keeps voicemail delivery, Slybroadcast, Voicemod API control, inbound browser calling, call recording, transcription, and AI participation outside the first version.

## Goals

- Place a normal outbound telephone call from the existing Call Workspace.
- Keep the profile, script, history, call controls, notes, outcome, and follow-up workflow together.
- Use the verified Adventure Zone work number as outbound caller ID without porting it.
- Carry both microphone input and caller audio through the browser and the selected computer audio devices.
- Save technical call metadata without saving audio.
- Preserve Windows Phone Link as a visible fallback.
- Keep all Twilio secrets on the server.
- Make failures understandable and recoverable.

## Non-goals

The first version will not:

- Receive calls in the browser.
- Port the Adventure Zone work number to Twilio.
- Change where callbacks ring.
- Send ringless voicemail or integrate Slybroadcast.
- Record, transcribe, summarize, clone, or generate speech.
- Control Voicemod through its API.
- Add predictive, progressive, automatic, or bulk dialing.
- Call emergency numbers.
- Replace the existing outcome and follow-up workflow.

Voicemod can still be used later as a Windows virtual microphone selected through the normal microphone picker. That requires no first-version Voicemod API integration.

## Current Application Context

The application already has:

- A React/Vite frontend in `artifacts/adventure-zone`.
- An Express API in `artifacts/api-server`.
- An existing guided `CallWorkspace`.
- A `PhoneActions` component and selected contact-phone flow.
- Existing assisted-calling enablement.
- Call drafts, scripts, manual call methods, outcomes, notes, and follow-up creation.
- Phone Link as the current live-call launcher.
- Owner-authenticated backend routes.

The new work should extend those boundaries instead of creating a separate dialer application.

## User Experience

### Before dialing

The Phone section retains the selected contact number and Phone Link fallback. When computer calling is configured, it also shows **Start computer call**.

Selecting **Start computer call**:

1. Shows the contact name and formatted destination number.
2. Confirms that this is an outbound call using the Adventure Zone work number.
3. Requests browser microphone permission when needed.
4. Lists available microphones and speakers when the browser exposes them.
5. Uses the saved device selection when it remains available.
6. Requires an explicit **Call now** action before connecting.

The application never starts a call merely by opening a profile or workspace.

### During the call

The call panel shows:

- Destination contact and number.
- `Connecting`, `Ringing`, `Connected`, `Ending`, or `Failed`.
- Elapsed connected time.
- Mute and unmute.
- DTMF keypad.
- Microphone selection.
- Speaker selection where supported by the browser.
- Hang up.

The existing guided script and business context remain visible throughout the call.

### After the call

When the call reaches a terminal state:

- The active controls close into a compact technical summary.
- The existing call outcome form remains the source of truth for the business outcome.
- The user selects the outcome, writes notes, and schedules any follow-up.
- Technical metadata may prefill start time, end time, duration, direction, and method.
- The application never infers that a person answered merely from a provider status; the user still records the actual business result.

Phone Link remains available when Twilio is disabled, unconfigured, unsupported, or failing.

## Call Architecture

### Browser

Use the Twilio Voice JavaScript SDK in the existing React application.

A focused computer-call controller owns:

- Twilio `Device` creation and cleanup.
- Short-lived token acquisition.
- Input and output device discovery.
- Call state transitions.
- Mute, DTMF, and disconnect actions.
- Browser permission and compatibility errors.
- Releasing microphone resources after the call ends.

The controller exposes a small state-and-actions interface to the Call Workspace. Provider-specific details must not spread through the profile, script, notes, or follow-up components.

### Server

Create a calling feature module in the Express API with these responsibilities:

1. Validate configuration at request time and report calling as unavailable when incomplete.
2. Issue short-lived Twilio Voice access tokens only to authenticated, authorized users.
3. Create one-time outbound call intents from an existing contact-phone record.
4. Generate TwiML for a validated call intent.
5. Validate Twilio webhook signatures.
6. Receive provider status callbacks.
7. Persist technical call-session metadata.

The server must resolve the actual destination number from the stored contact-phone record. It must not trust a raw destination number supplied later by the browser or Twilio webhook.

### One-time call intent

Before connecting, the browser posts an organization/contact/phone context to the server. The server:

- Confirms owner authorization.
- Confirms assisted computer calling is enabled.
- Loads the stored contact-phone record.
- Rejects invalid, missing, suppressed, or Do Not Call numbers.
- Normalizes the allowed destination to E.164.
- Creates a short-lived, single-use call intent tied to the authenticated user.
- Returns only the opaque intent identifier and safe display data.

The browser passes the intent identifier through `Device.connect()`. The TwiML webhook validates it, verifies the browser token identity, binds it to the Twilio `CallSid`, and marks it consumed before dialing. A Twilio retry with the same `CallSid` may receive the same TwiML response; a different `CallSid`, reuse, expiration, identity mismatch, or altered context fails closed.

### TwiML

The outbound TwiML:

- Dials only the server-resolved destination.
- Uses the configured, Twilio-verified Adventure Zone work number as caller ID.
- Does not enable recording.
- Includes a signed status-callback route.
- Applies a reasonable timeout.
- Supports keypad tones during a connected call.

### Technical call session

Persist provider-neutral technical metadata separately from narrative call notes:

- Internal session ID.
- User identity.
- Organization, contact, and contact-phone IDs.
- Provider name.
- Provider call identifier.
- Direction: outbound.
- Method: browser VoIP.
- Created, started, answered, ended, and updated timestamps when available.
- Final technical status.
- Provider error code and a sanitized error summary when applicable.
- Duration derived from trusted timestamps.
- Caller ID used.

Do not persist access tokens, API secrets, media, recordings, transcripts, or raw webhook payloads. Microphone and speaker labels may exist only in transient browser UI state.

The existing saved call activity remains the business record. It may reference the technical session ID so duration and technical result can be included without duplicating narrative notes.

## Security and Privacy

- Store Twilio secrets only in Render environment variables.
- Never expose Account SID secrets or API-key secrets to the browser.
- Browser tokens are short lived and limited to Voice use.
- Derive the token identity from the authenticated application user.
- Require existing owner authentication for token and intent routes.
- Validate `X-Twilio-Signature` on TwiML and status webhooks.
- Rate-limit intent and token creation per authenticated user.
- Restrict destinations to stored, callable contact-phone records.
- Honor existing Do Not Call and call-suppression rules before creating an intent.
- Do not support 911 or other emergency dialing.
- Do not log full tokens, secrets, authorization headers, or complete webhook bodies.
- Do not record or transcribe calls.
- Show the exact destination before the explicit final dial action.

## Configuration

Server configuration:

- `TWILIO_VOICE_ENABLED`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_TWIML_APP_SID`
- `TWILIO_VERIFIED_CALLER_ID`
- `TWILIO_WEBHOOK_BASE_URL`

Existing assisted-calling enablement remains the product-level gate. Computer calling is available only when both the product gate and complete Twilio configuration are present.

Configuration health responses may report missing variable names but must never return their values.

## State Model

The frontend state machine is:

- `idle`
- `checking-devices`
- `ready`
- `requesting-intent`
- `connecting`
- `ringing`
- `connected`
- `ending`
- `completed`
- `failed`

Only valid transitions are permitted. Duplicate button presses must not create duplicate intents or simultaneous calls. Navigating away or unmounting disconnects the active device safely after warning the user when a call is live.

The server status model normalizes provider statuses into:

- `created`
- `queued`
- `ringing`
- `in-progress`
- `completed`
- `busy`
- `no-answer`
- `canceled`
- `failed`
- `unknown`

Unknown provider statuses are stored as `unknown` with a sanitized diagnostic and logged for review; they are not misreported as completed or failed.

## Error Handling

User-facing errors use plain language and retain Phone Link as a fallback:

- Microphone denied: explain how to allow it and retry.
- No microphone: ask the user to connect or select one.
- Unsupported browser or insecure context: explain that browser calling is unavailable.
- Twilio not configured: state that computer calling has not been enabled.
- Invalid or suppressed number: prevent dialing and direct the user to correct the profile.
- Token or intent failure: do not dial; allow retry.
- Busy or no answer: show the technical result and leave outcome selection to the user.
- Network or media failure: end safely, preserve the draft, and allow Phone Link.
- Unexpected disconnect: persist the final provider state when the callback arrives.
- Status callback delay: show a locally known state first and reconcile when the provider update arrives.

Technical errors are logged with correlation IDs. Secrets and unnecessary phone-number exposure are excluded from logs.

## Integration Boundaries

Expected areas of change:

- `artifacts/adventure-zone/src/components/calls/call-workspace.tsx`
- `artifacts/adventure-zone/src/components/calls/phone-actions.tsx`
- New focused frontend calling controller/components under the calls feature.
- Frontend API actions/client contracts for capability, intent, token, and session status.
- New Express calling routes under `artifacts/api-server/src/routes`.
- New server calling feature modules under `artifacts/api-server/src/features/calls`.
- Database schema/migration for provider-neutral technical call sessions and one-time intents.
- Render environment configuration documentation.
- Tests colocated with the affected frontend and server modules.

Exact filenames may follow the repository's current conventions discovered during implementation, but the component and service boundaries in this design remain fixed.

## Testing Strategy

### Server tests

- Reject unauthenticated token and intent requests.
- Report disabled or incomplete configuration without exposing values.
- Issue a short-lived Voice token for an authorized user.
- Resolve the destination from the stored phone record.
- Reject missing, malformed, Do Not Call, and suppressed numbers.
- Reject expired, reused, or wrong-owner intents.
- Reject invalid Twilio signatures.
- Generate TwiML with the verified caller ID and no recording.
- Map Twilio callback states into the normalized session model.
- Make callback processing idempotent.
- Avoid duplicate sessions on retries.
- Sanitize provider errors and logs.

Use a provider adapter/fake in automated tests; CI must not place real calls.

### Frontend tests

- Show computer calling only when capability is enabled.
- Require an explicit confirmation before dialing.
- Handle microphone permission accepted and denied.
- Select and release audio devices.
- Render valid state transitions.
- Prevent duplicate call starts.
- Exercise mute, keypad, and hang-up.
- Keep the call script and context usable during a call.
- Preserve the existing outcome form after completion or failure.
- Keep Phone Link available as fallback.
- Clean up the Twilio Device on disconnect and unmount.

### Manual acceptance test

1. Configure a Twilio account and verify the Adventure Zone work number.
2. Keep computer calling disabled in production.
3. Call a phone controlled by the tester from a staging or owner-only environment.
4. Confirm the recipient sees the Adventure Zone work number.
5. Confirm two-way computer audio.
6. Confirm mute, keypad, hang-up, and duration.
7. Confirm no Twilio recording is created.
8. Confirm incoming callbacks still ring the physical work phone.
9. Confirm the technical session and manually selected business outcome are saved correctly.
10. Enable the production feature flag only after all checks pass.

## Rollout and Recovery

Roll out behind the existing assisted-calling gate plus `TWILIO_VOICE_ENABLED`.

Deployment order:

1. Database migration and server routes.
2. Render secrets and webhook base URL.
3. Twilio TwiML application and verified outgoing caller ID.
4. Frontend controller and call controls.
5. Automated tests.
6. Controlled real call.
7. Owner-only production enablement.

Disabling `TWILIO_VOICE_ENABLED` immediately hides computer calling without affecting profiles, scripts, notes, outcomes, follow-ups, or Phone Link. Existing technical call records remain readable.

## Acceptance Criteria

The design is complete when:

- An authorized user can open an existing contact in Call Workspace and place one outbound call through the computer.
- The user hears the recipient through the computer and the recipient hears the selected computer microphone.
- The recipient sees the verified Adventure Zone work number.
- Incoming calls and callbacks continue to use the physical work phone.
- The user can mute, send keypad tones, hang up, and see call status and duration.
- The user completes the existing outcome, notes, and follow-up flow after the call.
- Technical metadata is saved without audio, recording, or transcription.
- Suppressed and Do Not Call numbers cannot be dialed.
- Phone Link remains available when browser calling is disabled or fails.
- Automated tests do not place real calls.
