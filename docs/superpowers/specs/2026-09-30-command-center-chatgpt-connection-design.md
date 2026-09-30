# Command Center connection for ChatGPT and assistant handoffs

Status: proposed design for owner review; no product code or account settings changed.

## Intended outcome

Desiree wants to keep researching, drafting and coordinating in ChatGPT because the in-app assistant feels too expensive. Command Center should hold the business records, drafts and task progress. A future lead researcher, drafter and reviewer should use the same records and hand off work without duplicate profiles or repeated research.

Success means a request here can read relevant history and save authorized results directly, with no second model invocation inside Command Center. Hosting, ChatGPT usage and external services may still cost money. This design does not diagnose actual billing emails or promise unlimited/free agent execution.

## Findings and current base

Remote main inspected September 30 UTC: `fe7c14562cb0a3e903d32404e5d320200d65edef`. Profile-task PR #960 is now merged; deployment and feature activation were not checked in this investigation.

Existing assistant-import routes provide profile search, profile history, contact creation, event-profile operations, profile notes and office tasks. Current-main profile history and assistant-import source blobs match the inspected local checkout. Existing authentication uses a shared assistant-import bearer token. This is useful existing server logic, but is not a scoped, individually revocable ChatGPT connection.

The prior profile-task implementation dispatches child runs through the paid model worker. It cannot be treated as an external assistant checklist unchanged. The current-main assistant-workspace route differs from the earlier local branch; implementation must start from refreshed main and inspect the current routes again before modifying them.

No Command Center plugin was found in the available tool inventory or the plugin search results. That is not proof none exists elsewhere. No credentials were requested or inspected.

## Approaches

| Approach | Benefit | Trade-off |
| --- | --- | --- |
| Direct authenticated MCP connection, reusing app services (recommended) | Clear tools usable from supported ChatGPT clients; database actions need no app model call | Requires authentication, tool definitions and client installation testing |
| Browser operation of the app | Uses existing screens | More navigation and brittle handoffs; poor fit for recurring jobs |
| Continue optimizing the in-app model runner | Retains current chat UI | Keeps separate model usage and does not solve the user's preferred workflow |

Choose the direct connection. Keep the existing in-app assistant available; disabling it, stopping jobs or changing billing is a separate explicit operational action.

## First release: direct app tools

Expose a private Streamable HTTP MCP endpoint in the existing API deployment. Share domain services with ordinary app routes; do not expose arbitrary HTTP forwarding, SQL, shell execution or code editing. Do not mirror the entire internal API.

| Tool | Outcome and limits |
| --- | --- |
| Search profiles | Paginated matches with stable IDs, location, event year and duplicate hints |
| Read profile context | One bounded result containing profile details, contacts, notes, bookings, follow-ups and document references; explicit pagination for long history |
| Read saved document text | Read existing extracted text for an authorized document; report missing extraction without starting paid extraction |
| Create researched lead | Search for duplicates first; create a profile with source references and unknown fields preserved; ambiguous matches return candidates |
| Append research note | Save supplied research and its sources, clearly separating verified facts from unknown dates or contact roles |
| Propose profile update | Concrete old/new values and expected revision; overwrites require approval of that exact proposal |
| Apply approved profile update | Apply only the authorized current revision and return a saved receipt; stale changes require fresh review |
| Save app draft | Save supplied HTML/text with profile, event year, thread and document associations; sanitize HTML; no send or automatic Gmail write |
| Manage follow-up | List/create/update a scoped follow-up with expected revision and a receipt |

Tools accept structured inputs and return record IDs, app links, revisions, source references and operation receipts. Reads have bounded sections and pagination. Large histories and document bodies are fetched on demand. A missing year/contact/source remains unknown; a general office contact is not relabeled as an event organizer.

Reuse existing profile repositories and draft sanitation/association validation. Extract shared services where route handlers currently contain the implementation. Do not call owner-only HTTP routes using a hidden owner session, or weaken their authentication for the connection.

## Connection and permissions

Use the supported MCP OAuth flow with owner consent, authorization-code flow with PKCE, resource/audience binding, strict redirect validation and server-validated scopes. Keep passwords and bearer tokens out of chats, model inputs, tool results and logs. Use established protocol libraries; the implementation plan must select the maintained library after checking current repository dependencies.

The owner connects in the app and can revoke the connection. Store connection identity, approved scopes and revocation state server-side. Use short-lived access credentials and protected refresh credentials. Deny expired, revoked, wrong-audience and insufficient-scope requests.

Separate read, append/create, draft, follow-up and profile-update permissions. Creating a proposed overwrite does not authorize applying it. An approval is bound to connection/owner, target, exact content and revision, with single-use execution and an expiry. Client-side confirmation alone is not a server authorization mechanism.

Do not grant email sending, signed-contract changes, invoice/payment actions, deletion, code changes or infrastructure access in the first release. Existing explicit sending workflows can continue separately.

## Reliability and cost boundary

Every mutation requires a request key. Store the normalized input hash and durable result under a unique connection/operation/key constraint. Repeating the same request returns the original receipt; reusing a key with different input returns a conflict. Execute the mutation and receipt write in one database transaction.

Duplicate-lead checks must be transactionally protected for strong identities such as an existing source ID or normalized official website plus event identity. Similar names alone yield review candidates; never auto-merge them. Preserve event years as separate context rather than generating duplicate organizations for each year.

Revision checks prevent one assistant from silently overwriting another's work. A network timeout must be resolved by reading the operation receipt, not by guessing whether a save succeeded. Record connection, actor, operation, target and source provenance in the audit trail.

The connection service must not depend on model configuration or call assistant runtime startup, research providers, document extraction providers, model generation, RunStore enqueue, or the paid scheduler. It remains usable with in-app AI disabled. Supplied drafts and research are saved as data.

## Second release: shared work and handoffs

After the direct connection works from the user's actual ChatGPT client, add shared external-work tasks. This is a separately testable increment; it must not delay basic profile access.

Represent each task with an objective, fixed scope, profile IDs, requested role, status, version, evidence, drafts/receipts and next step. Reuse the existing task-state concepts and UI where useful. External tasks must have an explicit execution mode that excludes them from the app's AI scheduler at every claim/enqueue boundary. Existing tasks retain their original execution mode; do not silently convert running work.

A task item moves through queued, claimed, ready-for-next-role, needs-review and completed states. Claim leases and fencing prevent two assistants from performing the same item concurrently. Expiry releases a claim; a resumed client reconciles receipts before retrying. Pause and Cancel prevent new claims and writes but preserve already committed receipts.

The intended workflow is researcher → drafter → reviewer → owner. A handoff records a durable next job and its evidence. It does not promise that another dot automatically starts. Actual dot identities, custom-tool access, scheduling, handoff triggers and any associated usage charges must be tested in Desiree's account. Until verified, ChatGPT can explicitly pick up the next queued item through the same connection.

Email sending remains a distinct owner-authorized operation. Finding a lead, creating a draft or marking a review complete never grants permission to send.

## Acceptance tests and rollout

1. With model-provider access disabled and no app AI key configured, read a profile and save a supplied note/draft successfully. Assert zero model/provider calls and zero worker enqueues.
2. Repeat a timed-out mutation and verify exactly one record and one durable receipt; conflicting reuse of its key fails.
3. Concurrent lead creation with the same strong identity cannot create duplicates; ambiguous names remain review candidates.
4. Reject wrong-scope, revoked, expired and wrong-audience connections. No credentials appear in logs or returned errors.
5. Changing a profile after review makes the old approval fail; a newer review is required. Unauthorized overwrites cannot be applied.
6. Context reads honor limits, pagination and document access checks; unknown evidence stays unknown.
7. Test installation and real tool discovery in the user's supported ChatGPT surface, then verify the Android/Fold workflow separately. Do not claim desktop success proves mobile support.
8. For the handoff increment, test real PostgreSQL concurrent claims, lease recovery and cancellation; prove external tasks never reach the model scheduler.

Deliver the first release in a draft PR with the connection disabled by default. Review tests and the exact consent screen before deployment/connection. Run one explicitly authorized, reversible profile-read/note-save check in the connected account. Expand to role handoffs only after the account's dot capabilities are confirmed.

## Documentation consulted

- https://developers.openai.com/plugins/quickstart — private plugin connection and testing workflow.
- https://developers.openai.com/plugins/plan/tools — goal-oriented tool boundaries and permission distinctions.
- https://developers.openai.com/plugins/build/auth — MCP authentication and authorization requirements.

These documents establish the integration mechanism, not availability of a particular dot feature or billing arrangement in this account.
