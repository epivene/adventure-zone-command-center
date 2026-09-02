# Twilio Incoming Computer Calling and Voicemail Design

Date: 2026-09-02

Status: Approved design

Repository: `epivene/adventure-zone-command-center`

## Summary

Add inbound browser calling and voicemail to the Adventure Zone Command Center while preserving the existing Verizon work number as the public business number.

The user manually enables Verizon immediate call forwarding during computer-calling sessions. Verizon forwards calls from the existing work number to a Twilio-owned number. Twilio then rings one registered Command Center browser tab. An answered call uses the computer microphone and speakers. A declined, unanswered, or unavailable call goes to a Command Center voicemail inbox.

When the user finishes the session, they disable Verizon forwarding so calls return to the physical work phone and its normal carrier behavior. The application cannot change or inspect Verizon forwarding state and must never claim that it has done so.

This feature extends the approved outbound-only Twilio computer-calling design. It does not replace its destination controls, outcome workflow, or no-recording rule for answered conversations.

## Goals

- Keep the existing Verizon work number as the number contacts know and see.
- Receive forwarded work-number calls in an authorized Command Center browser.
- Ring while the Command Center tab is open but in the background.
- Show the matched contact and organization when the caller number matches a saved profile.
- Let the user answer, decline to voicemail, mute, use the keypad, and hang up from the computer.
- Route unanswered, declined, or unavailable calls to a two-minute voicemail greeting.
- Present voicemail in an authenticated Command Center inbox without transcription.
- Retain voicemail audio for 30 days, then delete the Twilio recording automatically.
- Preserve narrative notes and basic call history after voicemail audio is deleted.
- Keep answered conversations unrecorded.
- Keep inbound calling independently disabled until direct-Twilio-number and Verizon-forwarding acceptance tests pass.

## Non-goals

This release will not:

- Port the Verizon work number to Twilio.
- Automate, inspect, or guarantee Verizon call-forwarding state.
- Ring the physical Verizon work phone and the computer simultaneously.
- Receive calls when the browser is fully closed.
- Add native mobile push calling or a service-worker softphone.
- Record, transcribe, summarize, or apply AI to answered conversations.
- Transcribe voicemail.
- Email voicemail recordings.
- Add a multi-agent queue, hold music, transfers, supervisor controls, or conference calling.
- Receive or forward SMS messages. Verizon call forwarding applies only to voice calls.
- Add incoming Slybroadcast, ringless voicemail, or Voicemod API behavior.
- Allow emergency calling.

## Current Application Context

The outbound computer-calling implementation already provides:

- A server-issued short-lived Twilio Voice access token.
- A stable authenticated owner identity.
- A provider adapter around the Twilio Node SDK.
- A frontend adapter around the Twilio Voice JavaScript SDK `Device`.
- Browser microphone and speaker selection.
- Mute, keypad, hang-up, status, timing, and outcome workflows.
- Signed public Twilio webhook validation.
- A provider-neutral outbound technical-session record.
- Feature flags and fail-closed configuration checks.
- Phone Link as an outbound fallback.

The existing `computer_call_sessions` table has outbound-only constraints and requires an existing organization, contact, and phone. Those invariants are correct for server-approved outbound dialing. Inbound calls may come from unknown numbers, so this design must not weaken the outbound table or allow an unknown raw number into the outbound intent flow.

## Relationship to the Outbound Design

The approved outbound design and pull request remain outbound-only and must be reviewed and merged without this feature's implementation scope. This incoming feature is a later, separately gated change built on top of it.

When inbound calling is disabled or Verizon forwarding is off, the outbound design's original behavior remains unchanged: callbacks ring the physical work phone. This specification supersedes that callback behavior only during a deliberately enabled incoming-computer session after the user activates Verizon forwarding.

The existing verified Verizon work number remains `TWILIO_VERIFIED_CALLER_ID` for outbound calls. The purchased Twilio number is configured separately as the inbound forwarding destination.

## Carrier Operating Model

### Start a computer-calling session

1. Open the Command Center in a supported desktop browser.
2. Turn **Available for incoming calls** on.
3. Allow microphone and notification permissions when requested.
4. Wait for the application to show **Ready for incoming calls**.
5. From the Verizon work phone, dial `*72` followed by the ten-digit Twilio number.
6. Listen for Verizon's confirmation before relying on forwarding.
7. Confirm in the Command Center that forwarding was enabled manually. This acknowledgement is a reminder only; it is not carrier verification.

### End a computer-calling session

1. Turn **Available for incoming calls** off.
2. The Command Center shows a persistent instruction to dial `*73` from the Verizon work phone.
3. Dial `*73` and listen for Verizon's confirmation.
4. Confirm manually in the Command Center that forwarding was disabled.

The application must not automatically clear the forwarding reminder merely because the browser device unregistered or the user closed a call panel.

### Important carrier limitations

- Immediate forwarding means the Verizon work phone does not ring while `*72` forwarding is active.
- Verizon voicemail is bypassed while immediate forwarding is active.
- Twilio must never dial the forwarding Verizon work number as an inbound fallback because that would create a forwarding loop.
- If the user forgets `*73`, work-number calls continue to reach Twilio even when the browser is unavailable. The Twilio voicemail or safe service-unavailable fallback handles those calls.
- Verizon may charge forwarded calls according to the work-phone plan. Twilio charges the forwarded inbound leg and applicable voicemail recording/storage usage.
- The controlled rollout must confirm that Verizon preserves the original caller ID in Twilio's signed `From` field. If it does not, profile matching is disabled rather than guessed.

## User Experience

### Availability control

Add a global **Available for incoming calls** control in the authenticated Command Center shell, with the detailed device controls available from the Call Workspace.

Availability states are:

- `Off`
- `Checking microphone`
- `Registering`
- `Ready`
- `Incoming call`
- `On call`
- `Reconnecting`
- `Unavailable`

Turning availability on:

- Confirms that inbound computer calling is enabled and completely configured.
- Obtains a short-lived Voice token with incoming permission.
- Creates or updates the Twilio `Device`.
- Registers the device for incoming calls.
- Requests notification permission without making it a requirement for in-app ringing.
- Acquires a server-backed availability lease so only one browser session is the active phone.
- Shows the selected microphone and speaker.
- Does not claim that Verizon forwarding is active.

Turning availability off:

- Rejects or ends no active call automatically; the user must end or decline it first.
- Unregisters and destroys the Twilio device.
- Releases the cross-tab lease and microphone resources.
- Shows the `*73` forwarding reminder until the user acknowledges completing it.

### Single active browser tab

Only one browser session per authenticated account may be the incoming phone. Use a renewable server-backed availability lease with an opaque, lease-specific Twilio client identity and a heartbeat. A stale lease expires automatically after a short interval. A lightweight cross-tab channel prevents avoidable lease races between tabs in the same browser, but the server lease remains authoritative across browsers and computers.

Other sessions show that another browser is active and may offer **Make this browser the phone** only when no call is active. Taking over invalidates the previous lease and issues a new client identity before the new browser registers. The old device may remain connected briefly, but Twilio never dials its expired identity. A race must fail closed so two sessions do not both present themselves as the primary phone.

### Incoming call presentation

When Twilio emits an incoming call:

- Show a global Answer/Send to voicemail panel over the current Command Center page.
- Play a local ring tone until the call is answered, declined, canceled, or timed out.
- Show a desktop notification when permission exists and the tab is in the background.
- Clicking the notification focuses the Command Center and displays the incoming panel.
- Never place or answer a call merely because a notification was clicked.

For a matched caller, show:

- Contact name.
- Organization.
- Formatted caller number.
- A link to open the existing profile.
- Recent relevant call context when it can be loaded safely before answer.

For an unmatched caller, show the formatted number and **Unknown caller**. Do not create or modify a profile automatically.

### Answered call

Selecting **Answer** explicitly accepts the Twilio call and opens the existing guided Call Workspace in inbound mode. It shows:

- Caller identity or **Unknown caller**.
- `Connecting`, `Connected`, `Ending`, or `Failed`.
- Connected duration.
- Mute and unmute.
- DTMF keypad.
- Microphone and supported speaker selection.
- Hang up.
- Existing notes, outcome, and follow-up controls.

The business outcome remains user-selected. Provider status alone does not prove that the intended contact answered or that a booking conversation occurred.

For an unknown caller, the post-call flow allows the user to link the call to an existing profile or create a profile. Until a stored contact-phone record exists, **Call back** remains disabled so the existing outbound anti-arbitrary-dial controls are preserved.

### Send to voicemail

Selecting **Send to voicemail** declines the browser leg and routes the live caller immediately to the same voicemail flow used for no answer. Closing the incoming panel must not silently accept or discard the call.

### Background and closed-browser behavior

- An open background tab may ring and display a desktop notification.
- If notifications are denied, an open tab still rings in the application.
- A fully closed browser cannot receive the call; Twilio routes it to voicemail.
- A lost browser registration, expired token, missing microphone, or connection failure makes the browser unavailable and routes an unanswered call to voicemail.
- If a connected call loses the browser media connection, end it safely and preserve the technical result. Do not start voicemail after an answered conversation has already connected.

## Inbound Call Architecture

### Carrier and Twilio number

The existing Verizon work number remains the public number and the verified outbound caller ID. The purchased Twilio voice number is a private carrier-forwarding destination.

Configure the Twilio number's **A call comes in** webhook as an HTTPS `POST` to:

```text
https://<api-host>/api/webhooks/twilio/voice/inbound
```

This incoming-number webhook is separate from the outbound TwiML Application Voice Request URL:

```text
https://<api-host>/api/webhooks/twilio/voice/outbound
```

Changing the Twilio number's incoming webhook must not change or replace the outbound TwiML Application.

### Server-issued Voice token

Continue to generate Voice access tokens on the authenticated server with a Standard Twilio API key. Restricted Twilio API keys cannot generate Voice access tokens.

When both outbound and inbound calling are enabled, the Voice grant contains:

- The existing outbound TwiML Application SID.
- Incoming permission for the current server-issued availability-lease identity.

The server maps the opaque lease identity back to the authenticated owner for the existing outbound intent checks; it never derives authorization from identity text supplied by the browser. When inbound calling is disabled, the token must not authorize incoming registration. Token expiry remains short, and the registered browser refreshes before expiry without persisting the token.

### Signed inbound entry webhook

The public inbound webhook:

1. Validates `X-Twilio-Signature` against the exact public URL and full form field map.
2. Validates that the signed `To` value is the configured Twilio ingress number.
3. Normalizes the signed `From` value when it is a callable NANP number.
4. Creates or finds an idempotent inbound technical session by parent `CallSid`.
5. Matches the caller number to existing contact-phone records without creating data.
6. Resolves the current unexpired availability lease and returns TwiML that dials only its server-issued client identity.

The TwiML uses a roughly 25-second `<Dial>` timeout with a `<Client>` target and an action callback. It does not enable answered-call recording. Browser-leg status callbacks update the technical session idempotently.

The webhook never trusts a caller-supplied organization, contact, user, client identity, recording URL, or destination number.

### Dial result and voicemail transition

The signed `<Dial>` action callback receives the authoritative dial result.

- `completed` after an answered client call finishes: end the inbound session; never start voicemail.
- `busy`, `no-answer`, `failed`, or an explicit browser rejection: enter voicemail exactly once.
- Unknown future provider states: record a sanitized `unknown` technical state and choose the fail-safe voicemail path only when Twilio confirms the browser leg never connected.

Duplicate and out-of-order callbacks must not create duplicate sessions, greetings, or voicemail records.

### Safe service fallback

Configure the Twilio number with a fallback URL that serves static TwiML outside the application deployment. The fallback says that The Adventure Zone cannot answer due to a temporary technical problem and asks the caller to try again later, then hangs up.

The fallback must not record a voicemail because the application may be unavailable to authenticate, persist, retain, or delete it correctly.

## Voicemail Architecture

### Greeting and recording

The approved greeting is:

> You've reached The Adventure Zone. We can't answer right now. Please leave your name, event, phone number, and a brief message after the beep.

The voicemail TwiML:

- Uses `<Record>` only after the caller hears the greeting.
- Plays a beep.
- Limits the message to 120 seconds.
- Disables transcription.
- Includes signed action and recording-status callbacks.
- Plays a short thank-you message when a recording completes normally.
- Does not record an answered two-party conversation.

### Storage model

Keep the outbound `computer_call_sessions` constraints intact. Add isolated inbound records:

#### Inbound technical session

- Internal session ID.
- Owner identity.
- Twilio parent call SID and optional browser child-call SID.
- Provider and method.
- Direction: inbound.
- Configured Twilio ingress-number snapshot.
- Normalized caller-number snapshot when valid.
- Optional matched organization, contact, and contact-phone IDs.
- Created, ringing, answered, ended, and updated timestamps.
- Technical status and sanitized provider error information.
- Whether the browser leg was answered, declined, unavailable, or timed out.

#### Voicemail

- Internal voicemail ID.
- Inbound session ID.
- Twilio recording SID, never a public recording URL.
- Recording status, duration, and media content type.
- Created and updated timestamps.
- Retention deadline set to 30 days after recording completion.
- New, handled, or deleted state.
- Handled timestamp and authenticated user identity.
- Optional matched or manually linked organization, contact, and phone IDs.
- Provider deletion status and last safe deletion error.

Do not persist Twilio access tokens, API secrets, Auth Tokens, raw webhook bodies, transcriptions, browser device labels, or browser notification contents.

### Authenticated playback

The browser requests playback through an owner-authenticated API route using the internal voicemail ID. The server:

- Confirms the voicemail belongs to the authorized account.
- Resolves the provider recording SID server-side.
- Fetches or streams media using server-only Twilio credentials.
- Sets a narrow audio content type and anti-caching headers appropriate for private media.
- Never exposes a reusable Twilio media URL or credentials.

### Inbox behavior

The voicemail inbox shows:

- New or handled status.
- Matched contact and organization when available.
- **Unknown caller** when unmatched.
- Caller number, received time, duration, and audio playback.
- **Open profile**, **Add note**, **Link profile**, **Call back**, and **Delete** as applicable.

**Call back** uses the existing server-approved outbound intent flow. It is enabled only after the voicemail is linked to a stored callable contact-phone record that passes the existing suppression and Do Not Call checks.

### Retention and deletion

- A scheduled cleanup finds completed voicemail recordings past their 30-day retention deadline.
- It deletes the Twilio recording using server-only credentials, then marks the local voicemail media as deleted.
- The operation is idempotent and retries bounded transient failures.
- A user-requested delete performs the same provider deletion before removing playback access.
- Basic inbound call history and user-authored notes remain after media deletion.
- The UI clearly distinguishes **audio deleted** from **call record deleted**.
- The system does not claim deletion until Twilio confirms success or confirms that the recording is already absent.

## Business Call History

An answered inbound call or handled voicemail may create or link an existing business call activity with:

- Direction: inbound.
- Method: browser VoIP or voicemail.
- Optional organization, contact, and phone IDs.
- Technical session reference.
- Start, answer, end, and duration metadata when authoritative.
- User-selected outcome, notes, and follow-up.

Unknown inbound calls remain in the inbound technical history until the user links them. Linking must be explicit and auditable; caller-number matching alone must not overwrite a profile.

## Frontend Components

Extend the current provider-neutral browser voice adapter rather than importing Twilio throughout the UI. The adapter adds:

- `register()` and `unregister()`.
- Registration and token-refresh events.
- Incoming-call events.
- Accept, reject/send-to-voicemail, and disconnect actions.
- Complete listener and device cleanup.

Add focused modules for:

- Incoming availability state and cross-tab lease.
- Global incoming-call panel.
- Desktop notification adapter.
- Inbound Call Workspace mode.
- Voicemail inbox and authenticated audio player.

Do not combine Verizon forwarding acknowledgements, Twilio device state, and active-call state into a single boolean. Each is independently observable and can fail separately.

## State Models

### Availability

- `off`
- `checking-media`
- `registering`
- `ready`
- `reconnecting`
- `unavailable`

### Incoming call

- `idle`
- `ringing`
- `accepting`
- `connected`
- `sending-to-voicemail`
- `ending`
- `ended`
- `failed`

### Voicemail

- `none`
- `greeting`
- `recording`
- `processing`
- `available`
- `handled`
- `deleting`
- `audio-deleted`
- `failed`

Provider events are normalized into these states. Unknown provider values remain `unknown` technical metadata and must not regress a terminal state.

## API Surface

Exact route naming may follow existing router conventions, but the boundaries are:

### Authenticated owner routes

- Get inbound configuration and safe readiness state.
- Acquire, renew, release, or explicitly take over the owner-scoped availability lease.
- Get a short-lived Voice token with incoming permission when enabled.
- List and read owner-scoped inbound sessions.
- List, read, mark handled, link, and delete owner-scoped voicemail.
- Stream voicemail audio through an authenticated server route.

### Public signed Twilio routes

- Inbound number entry TwiML.
- Browser dial-result TwiML.
- Inbound call and browser-leg status callbacks.
- Voicemail recording action and recording-status callbacks.

All public Twilio routes validate the signature before reading or mutating application state. All mutation routes are idempotent by provider SID plus event purpose.

## Configuration

Reuse the existing server-only Twilio configuration and add:

- `TWILIO_INBOUND_VOICE_ENABLED=false`
- `TWILIO_INBOUND_NUMBER`
- `TWILIO_VOICEMAIL_RETENTION_DAYS=30`
- `TWILIO_VOICEMAIL_MAX_SECONDS=120`

Continue to require:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_API_KEY_SID`
- `TWILIO_API_KEY_SECRET`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_TWIML_APP_SID`
- `TWILIO_VERIFIED_CALLER_ID`
- `TWILIO_WEBHOOK_BASE_URL`

The API key used for browser Voice tokens and Twilio recording media operations must be Standard or Main; use Standard for this application. The Account Auth Token remains separate and is used only for webhook signature validation.

Configuration health may expose missing variable names but never values, full phone numbers, tokens, or recording identifiers.

## Security and Privacy

- Keep all Twilio credentials in Render server environment variables.
- Keep the inbound number value server-side and redact phone numbers in routine logs.
- Validate every Twilio webhook signature using the exact public URL.
- Require the signed `To` number to match the configured ingress number.
- Treat the signed `From` number as untrusted matching input, not authorization.
- Authorize browser registration, session reads, voicemail playback, linking, and deletion with the existing owner authentication.
- Use short-lived Voice tokens and refresh them only in memory.
- Permit only the current server-issued availability-lease identity and map it to the owner server-side.
- Rate-limit token issuance and authenticated voicemail APIs.
- Do not include contact names, event details, or caller numbers in desktop notifications when the device is locked or notification privacy settings disallow them; default notification text to **Incoming Adventure Zone call**.
- Never record an answered browser call.
- Never transcribe voicemail.
- Never expose provider media URLs or credentials.
- Do not log raw webhook bodies, access tokens, recordings, or full caller numbers.
- Preserve the existing outbound Do Not Call and suppression checks for every callback.
- Do not support emergency dialing.

## Error Handling

- Inbound feature disabled or incomplete: do not register the browser; Twilio number returns the safe fallback response.
- Invalid webhook signature or wrong `To`: return a generic rejection without revealing configuration.
- Browser not registered: route the unconnected caller to voicemail.
- Browser rejects or times out: route to voicemail exactly once.
- Notification denied: keep in-app ringing available.
- Microphone unavailable: do not accept; allow voicemail.
- Token nearing expiry: refresh and update the device without persisting the token.
- Registration WebSocket lost: show `Reconnecting`; if not recovered, show `Unavailable`.
- Duplicate or out-of-order provider callbacks: process idempotently and never regress a terminal state.
- Caller-ID matching ambiguity: show **Unknown caller** and require manual linking.
- Recording processing delay: show **Processing** until Twilio confirms the recording is available.
- Recording playback failure: keep metadata and allow retry without exposing provider errors.
- Provider deletion failure: keep playback inaccessible after a user delete request, retry server-side, and accurately show deletion pending until confirmed.
- Application outage: static fallback message, no orphaned recording.
- Browser disconnect after answer: end safely and preserve timestamps; do not switch the caller to voicemail after a connected conversation.

## Testing

### Server tests

- Configuration remains disabled by default and fails closed when incomplete.
- Standard Voice tokens include incoming permission only when authorized and enabled.
- Availability lease acquisition, renewal, expiry, takeover, and active-call takeover rejection work across sessions.
- Signed inbound webhooks reject missing or invalid signatures and a mismatched `To` number.
- Inbound session creation is idempotent by parent call SID.
- Caller matching handles one match, no match, malformed caller ID, and ambiguous matches safely.
- Generated TwiML dials only the stable browser identity, times out appropriately, and never records the answered call.
- Dial outcomes route only never-connected calls to voicemail.
- Voicemail TwiML uses the approved greeting, beep, 120-second limit, no transcription, and signed callbacks.
- Duplicate recording callbacks do not create duplicate voicemail.
- Recording playback is owner-scoped and never exposes a provider URL.
- User and scheduled deletions are idempotent and preserve history while removing media.
- Unknown callers cannot bypass the existing outbound intent restrictions.
- Provider statuses are monotonic and tolerate unknown future values.

### Frontend tests

- Availability registration and unregistration.
- Cross-tab coordination reflects the authoritative server lease without allowing two active sessions.
- Incoming matched and unknown caller presentations.
- Answer, send to voicemail, remote cancel, timeout, and failure transitions.
- Background notification behavior with permission granted, denied, and unavailable.
- Notification click focuses the panel but does not answer.
- Inbound Call Workspace controls and post-call outcome flow.
- Unknown caller linking without automatic profile mutation.
- Voicemail new/handled, playback, processing, deletion, and audio-deleted states.
- Persistent `*72` and `*73` reminders without false carrier-state claims.
- Navigation and browser-close warnings during an active call or unconfirmed forwarding session.

Automated tests use mocked provider and browser adapters. They must never enable Verizon forwarding, place a real call, or create a real recording.

## Controlled Rollout

1. Merge and deploy the outbound computer-calling work while both computer-calling flags remain disabled.
2. Add the inbound schema, server routes, browser registration, notifications, Call Workspace mode, voicemail inbox, retention job, and tests.
3. Deploy with `TWILIO_INBOUND_VOICE_ENABLED=false`.
4. Configure the purchased Twilio number's primary signed inbound webhook and static fallback URL.
5. Call the Twilio number directly from a phone owned by the tester.
6. Verify matched and unknown caller behavior, background notification, answer, send to voicemail, no answer, authenticated playback, deletion, and no answered-call recording.
7. Test browser closed, API unavailable, invalid signature, token expiry, and multiple-tab behavior.
8. Enable inbound calling only for the authorized account.
9. From the Verizon work phone, dial `*72` plus the Twilio number and listen for confirmation.
10. Place one controlled call to the Verizon work number from another owned or consenting phone.
11. Confirm the original caller ID reaches Twilio, the browser rings, two-way audio works, and an unanswered retry reaches the Command Center voicemail inbox.
12. Dial `*73`, listen for confirmation, and call the work number again to confirm the physical Verizon phone resumes ringing.
13. Keep a written rollback card next to the work phone with `*73` and the Twilio inbound disable procedure.

Do not enable Verizon forwarding before direct calls to the Twilio number pass. Do not test with real event contacts.

## Rollback

1. Dial `*73` from the Verizon work phone and confirm carrier forwarding is off.
2. Set `TWILIO_INBOUND_VOICE_ENABLED=false` and redeploy or refresh configuration.
3. Confirm browsers unregister and show inbound calling unavailable.
4. Keep the Twilio number assigned to the safe static fallback while investigating.
5. Preserve technical call and voicemail metadata required for diagnosis, but never copy secrets, raw webhooks, recordings, or full phone numbers into tickets.
6. Leave the outbound feature independently controllable.

## Success Criteria

The feature is complete when:

- The authorized user can deliberately register one Command Center tab for incoming calls.
- A direct call to the Twilio number and a Verizon-forwarded call to the work number both ring that browser.
- The browser can ring in the background and display a privacy-safe desktop notification.
- The user can answer or send the caller to voicemail explicitly.
- Answered calls provide two-way computer audio and are never recorded.
- Unanswered, declined, and unavailable calls create one playable Command Center voicemail without transcription.
- Caller matching opens the correct existing profile when unambiguous and never creates a profile automatically.
- Unknown callers cannot be called back until linked to a stored callable phone record.
- Voicemail audio deletes after 30 days while notes and basic history remain.
- The application never claims to control Verizon forwarding and clearly reminds the user to use `*72` and `*73`.
- Disabling Verizon forwarding returns calls to the physical work phone.
- Inbound and outbound calling can be enabled or rolled back independently.

## External Operational References

- Verizon immediate forwarding uses `*72` plus the ten-digit destination; `*73` disables forwarding: <https://www.verizon.com/support/call-forwarding-faqs/>
- The Twilio Voice JavaScript SDK receives calls after `Device.register()`: <https://www.twilio.com/docs/voice/sdks/javascript/twiliodevice>
- TwiML `<Client>` routes a call to a Voice SDK client identity: <https://www.twilio.com/docs/voice/twiml/client>
- Twilio incoming calls are handled by an HTTPS webhook that returns TwiML: <https://www.twilio.com/docs/voice/tutorials/how-to-respond-to-incoming-phone-calls>
