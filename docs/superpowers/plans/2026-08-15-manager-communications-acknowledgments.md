# Manager Communications and Acknowledgments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a simple Slack-like manager/admin communication hub, admin-reviewed meetup/equipment requests, persistent acknowledgment cards for concrete admin changes, and admin filing of chat attachments into leg records.

**Architecture:** Keep the manager UI centered on one `Messages` destination while storing conversations, operational requests, acknowledgments, notifications, and filing provenance as separate focused domain records. Reuse the existing manager authentication, private object-storage, offline queue philosophy, and `equipment_handoffs` approval path rather than creating parallel systems.

**Tech Stack:** React + TypeScript + Wouter, Express, Drizzle/PostgreSQL, Google Cloud Storage, Vitest/Testing Library, existing manager auth and handoff services.

## Global Constraints

- The manager portal must stay simple enough for a first-time manager to understand without training.
- All in-app manager communication is visible to admins; there are no private in-app DMs from admin.
- Normal messages create unread/FYI notifications only; they do not require acknowledgment.
- Concrete admin operational changes stay visible until the affected manager acknowledges them.
- One admin save/action creates one grouped acknowledgment card, even when several fields changed.
- A manager comment on an acknowledgment changes it to `needs_admin_review`; the manager has still acknowledged seeing the change.
- Managers may propose meetups/equipment swaps, but only admin approval makes the handoff official.
- Approved meetup/equipment requests must reuse the existing `equipment_handoffs` system.
- Filing a chat attachment into a leg record must preserve the original message/attachment and retain provenance.
- Managers are notified after an admin files one of their attachments into a leg record.
- File/blob reads remain private and authorized/signed; do not make manager attachments public.
- Avoid reactions, bots, slash commands, typing presence, voice/video, or other Slack-clone scope in this release.
- Mobile-first: avoid dense multi-column manager layouts and keep advanced actions inside drawers/menus.

---

## File Structure

### Backend domain files

- Create `artifacts/api-server/src/features/manager-comms/communication-repository.ts`
  - conversations, members, messages, unread state, message attachments.
- Create `artifacts/api-server/src/features/manager-comms/communication-service.ts`
  - permission/visibility rules and simple conversation creation helpers.
- Create `artifacts/api-server/src/features/manager-comms/meetup-request-repository.ts`
  - manager proposals and admin review state.
- Create `artifacts/api-server/src/features/manager-comms/meetup-request-service.ts`
  - approval bridge into `HandoffRepository`.
- Create `artifacts/api-server/src/features/manager-comms/acknowledgment-repository.ts`
  - grouped admin changes, items, manager acknowledgment/comment, admin resolution.
- Create `artifacts/api-server/src/features/manager-comms/notification-repository.ts`
  - unread/FYI/action-required notifications.
- Create `artifacts/api-server/src/features/manager-comms/attachment-filing-service.ts`
  - links chat attachments to receipt/incident/equipment/general leg destinations and records provenance.
- Create focused test files beside each repository/service.

### API routes

- Modify `artifacts/api-server/src/routes/leg-manager.ts`
  - manager message reads/writes, attachment upload, meetup request creation, notification reads, acknowledgment actions.
- Modify `artifacts/api-server/src/routes/leg-manager-admin.ts`
  - admin message visibility, meetup review/approval, acknowledgment review/resolve, attachment filing.
- Modify the owner/admin mutation routes that change concrete leg operations so they call one shared acknowledgment recorder after successful saves.

### Frontend manager UI

- Create `artifacts/adventure-zone/src/pages/ManagerMessagesPage.tsx`
- Create `artifacts/adventure-zone/src/components/manager/messages/conversation-list.tsx`
- Create `artifacts/adventure-zone/src/components/manager/messages/conversation-view.tsx`
- Create `artifacts/adventure-zone/src/components/manager/messages/message-composer.tsx`
- Create `artifacts/adventure-zone/src/components/manager/messages/meetup-request-drawer.tsx`
- Create `artifacts/adventure-zone/src/components/manager/manager-action-center.tsx`
  - persistent acknowledgment/action-required cards.
- Modify `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
  - one Messages destination + unread/action badges; keep nav minimal.
- Modify `artifacts/adventure-zone/src/App.tsx`
  - `/manager/messages` route.

### Frontend admin UI

- Create `artifacts/adventure-zone/src/pages/ManagerCommunicationsAdminPage.tsx`
- Create `artifacts/adventure-zone/src/components/manager-admin/meetup-request-review.tsx`
- Create `artifacts/adventure-zone/src/components/manager-admin/acknowledgment-review.tsx`
- Create `artifacts/adventure-zone/src/components/manager-admin/attachment-file-menu.tsx`
- Modify `artifacts/adventure-zone/src/App.tsx` and owner navigation to expose one clear manager-communications admin destination.

---

### Task 1: Messaging schema and repository foundation

**Files:**
- Create: `artifacts/api-server/src/features/manager-comms/communication-repository.ts`
- Test: `artifacts/api-server/src/features/manager-comms/communication-repository.test.ts`

**Interfaces:**
- Produces:
  - `type ConversationKind = "all_managers" | "leg_admin" | "direct" | "group"`
  - `type MessageActor = { kind: "manager"; legId: string; name: string | null } | { kind: "admin"; name: string | null }`
  - `CommunicationRepository.ensureSchema()`
  - `listForManager(legId)`
  - `listAllForAdmin()`
  - `getMessages(conversationId, viewer)`
  - `sendMessage(input)` with `clientMutationId` idempotency
  - `markConversationRead(...)`
  - attachment metadata create/update helpers.

- [ ] **Step 1: Write failing repository tests** for global channel visibility, leg+admin membership, direct/group admin visibility, idempotent message retries, and unread state.
- [ ] **Step 2: Run tests and verify RED** with missing repository/schema behavior.
- [ ] **Step 3: Implement schema creation and repository methods** using focused SQL tables: `manager_conversations`, `manager_conversation_members`, `manager_messages`, `manager_message_attachments`, and read cursors/timestamps.
- [ ] **Step 4: Run repository tests and verify GREEN.**
- [ ] **Step 5: Commit** `feat: add manager communication repository`.

### Task 2: Messaging permissions, routes, attachments, and notifications

**Files:**
- Create: `artifacts/api-server/src/features/manager-comms/communication-service.ts`
- Create: `artifacts/api-server/src/features/manager-comms/notification-repository.ts`
- Test: corresponding service/repository tests.
- Modify: `artifacts/api-server/src/routes/leg-manager.ts`
- Modify: `artifacts/api-server/src/routes/leg-manager-admin.ts`
- Reuse: `artifacts/api-server/src/features/leg-manager/leg-manager-object-storage.ts`

**Interfaces:**
- Manager routes:
  - `GET /manager/messages/conversations`
  - `POST /manager/messages/conversations`
  - `GET /manager/messages/conversations/:id/messages`
  - `POST /manager/messages/conversations/:id/messages`
  - `POST /manager/messages/attachments`
  - `PUT /manager/messages/attachments/:id/file`
  - `POST /manager/messages/conversations/:id/read`
  - `GET /manager/notifications`
- Admin routes mirror reads across all conversations and permit admin posting.

- [ ] **Step 1: Write failing route/service tests** proving a manager can only post as themselves, admins can view every conversation, and manager-to-manager threads remain admin-visible.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement permission helpers** that treat admin as universal viewer and managers as participants only.
- [ ] **Step 4: Implement private attachment upload** using the existing object-storage adapter and signed read URLs; never expose bucket objects publicly.
- [ ] **Step 5: Add unread/FYI notification records** when a new message arrives for another participant.
- [ ] **Step 6: Run focused tests and API build.**
- [ ] **Step 7: Commit** `feat: expose manager messaging APIs`.

### Task 3: Simple manager Messages UI

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerMessagesPage.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/messages/conversation-list.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/messages/conversation-view.tsx`
- Create: `artifacts/adventure-zone/src/components/manager/messages/message-composer.tsx`
- Test: corresponding component/page tests.
- Modify: `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`

**Interfaces:**
- `/manager/messages` is the single primary communication destination.
- UI must display `Messages in this app are visible to admins.` in a subtle persistent location.

- [ ] **Step 1: Write failing UI tests** for opening Messages, sending text, attaching a file, unread badge display, and mobile conversation-list navigation.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement the page with only three primary elements:** conversation list, active conversation, composer/action area.
- [ ] **Step 4: Add `New message` flow** for manager/admin, manager/manager, and small group conversation creation without exposing channel configuration jargon.
- [ ] **Step 5: Add file/photo/PDF composer attachment handling** with clear queued/sending/failed status.
- [ ] **Step 6: Add one Messages nav item and unread badge** to `ManagerShell`; do not add separate Chat/Requests/Notifications nav destinations.
- [ ] **Step 7: Run focused UI tests, typecheck, and web build.**
- [ ] **Step 8: Commit** `feat: add simple manager messages hub`.

### Task 4: Manager meetup/equipment request domain and admin approval bridge

**Files:**
- Create: `artifacts/api-server/src/features/manager-comms/meetup-request-repository.ts`
- Create: `artifacts/api-server/src/features/manager-comms/meetup-request-service.ts`
- Test: repository/service tests.
- Modify: `artifacts/api-server/src/features/routes/handoff-repository.ts` only where a clean explicit approval input is required.
- Modify: manager/admin routes.

**Interfaces:**
- `MeetupRequestStatus = "pending_admin" | "approved" | "dismissed"`
- Manager proposal fields: requesting leg, other leg(s), resource, meetup label/coordinates, preferred start/end, notes, linked conversation/message IDs, `clientMutationId`.
- `approveMeetupRequest(requestId, adminEdits)` creates/updates the existing `equipment_handoffs` record and returns the finalized handoff.

- [ ] **Step 1: Write failing tests** proving proposal creation does not alter official handoffs/routes, retries are idempotent, and only admin approval creates the official handoff.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement meetup request persistence.**
- [ ] **Step 4: Implement admin approval service** that accepts revised legs/resource/location/window and writes through the existing handoff repository.
- [ ] **Step 5: Emit FYI notifications for request submitted/approved/dismissed.**
- [ ] **Step 6: Run tests and API build.**
- [ ] **Step 7: Commit** `feat: add admin-reviewed manager meetup requests`.

### Task 5: Meetup request UI without adding another manager page

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager/messages/meetup-request-drawer.tsx`
- Create: `artifacts/adventure-zone/src/components/manager-admin/meetup-request-review.tsx`
- Modify: `ManagerMessagesPage.tsx`
- Modify: manager route page only to add a small `Request meetup / equipment swap` entry point.
- Modify: admin communications page created later or temporary owner surface if needed.

- [ ] **Step 1: Write failing UI tests** for proposal form, admin-edit-before-approve, and linked discussion context.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement a drawer/form** asking only: other leg(s), equipment, preferred place, preferred time/window, notes, optional attachments.
- [ ] **Step 4: Implement admin review card** with editable fields and `Approve`, `Ask in chat`, `Dismiss` actions.
- [ ] **Step 5: Verify approved request appears through existing handoff views rather than a parallel meetup list.**
- [ ] **Step 6: Run focused tests/typecheck/build.**
- [ ] **Step 7: Commit** `feat: add meetup request review UI`.

### Task 6: Persistent admin-change acknowledgment foundation

**Files:**
- Create: `artifacts/api-server/src/features/manager-comms/acknowledgment-repository.ts`
- Create: `artifacts/api-server/src/features/manager-comms/acknowledgment-service.ts`
- Test: corresponding tests.
- Modify: manager/admin routes.

**Interfaces:**
- `AcknowledgmentStatus = "waiting_acknowledgment" | "acknowledged" | "needs_admin_review" | "resolved"`
- `recordAdminOperationalChange({ actionId, legIds, actor, sourceType, sourceId, items })`
- `items: Array<{ label: string; beforeValue: string | null; afterValue: string | null }>`
- Manager action: `acknowledge(id, comment?)`
- Admin action: `resolve(id, response?)`

- [ ] **Step 1: Write failing tests** for one grouped card per action, persistence until acknowledgment, comment -> `needs_admin_review`, admin resolution, and audit history retention.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement grouped acknowledgment storage** plus item rows and actor/timestamps.
- [ ] **Step 4: Implement manager acknowledge/comment transition**; require server success before UI may clear the waiting state.
- [ ] **Step 5: Implement admin review/resolve transition** without deleting the history.
- [ ] **Step 6: Run tests and API build.**
- [ ] **Step 7: Commit** `feat: add persistent manager acknowledgments`.

### Task 7: Instrument concrete admin changes and add persistent action UI

**Files:**
- Create: `artifacts/adventure-zone/src/components/manager/manager-action-center.tsx`
- Create: `artifacts/adventure-zone/src/components/manager-admin/acknowledgment-review.tsx`
- Modify: `artifacts/adventure-zone/src/components/manager/manager-shell.tsx`
- Modify: selected admin mutation routes/services that change booking dates/times, leg assignments, equipment/handoffs, crew assignments, and operational money/settlement instructions.
- Test: acknowledgment integration + UI tests.

- [ ] **Step 1: Write failing integration tests** proving a concrete admin save creates one acknowledgment and a normal chat/FYI action does not.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Add acknowledgment recording after successful concrete mutations** with before/after values captured from the same transaction/service boundary where practical.
- [ ] **Step 4: Implement small persistent manager action card** visible across manager pages, with `Acknowledge`, optional comment, and `Acknowledge & Send Comment`.
- [ ] **Step 5: Implement admin Needs Review list/card** showing original grouped change, manager comment, response field, and Resolve.
- [ ] **Step 6: Ensure a manager comment keeps the item visible as review-pending but marks manager acknowledgment time.**
- [ ] **Step 7: Run integration/UI tests, typecheck, API/web builds.**
- [ ] **Step 8: Commit** `feat: require acknowledgment for admin leg changes`.

### Task 8: Admin filing of chat attachments into leg records

**Files:**
- Create: `artifacts/api-server/src/features/manager-comms/attachment-filing-service.ts`
- Create: `artifacts/adventure-zone/src/components/manager-admin/attachment-file-menu.tsx`
- Test: service/UI tests.
- Modify: admin manager-communications routes/page.
- Reuse existing receipt/incident/object-storage services rather than re-uploading blobs.

**Interfaces:**
- Filing destination union:
  - `expense_receipt`
  - `incident_photo`
  - `equipment_handoff_photo`
  - `general_leg_document`
  - `manager_note_attachment` / `crew_note_attachment` only where destination support exists.
- `fileMessageAttachment({ attachmentId, destination, destinationMetadata, adminActor })`
- Produces provenance row with source conversation/message/sender/attachment and destination record.

- [ ] **Step 1: Write failing tests** proving the original chat attachment remains intact, destination receives the attachment/reference, provenance is retained, failures do not damage source chat, and sender notification is created.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement filing links/reference reuse**; avoid byte copy unless a destination integration technically requires a separate object, and if copied retain the same source provenance.
- [ ] **Step 4: Implement `Add to leg...` admin context menu** with a small destination-specific metadata drawer.
- [ ] **Step 5: Send manager FYI notification** such as `Receipt filed — Your photo was added to Kristy Leg → Expenses → Fuel → Aug 15` after successful filing.
- [ ] **Step 6: Run tests and builds.**
- [ ] **Step 7: Commit** `feat: file manager chat attachments into leg records`.

### Task 9: Unified admin communications surface and simplicity pass

**Files:**
- Create: `artifacts/adventure-zone/src/pages/ManagerCommunicationsAdminPage.tsx`
- Modify: `artifacts/adventure-zone/src/App.tsx`
- Modify: owner navigation.
- Test: admin page + manager end-to-end component tests.

- [ ] **Step 1: Write failing UI tests** showing admin can browse all chats, see pending meetup requests, see Needs Admin Review items, and file attachments without navigating to separate feature pages.
- [ ] **Step 2: Run tests and verify RED.**
- [ ] **Step 3: Implement one admin communications page** with lightweight tabs/filters such as `Messages`, `Requests`, and `Needs review`; do not create separate navigation items for each.
- [ ] **Step 4: Add plain-language empty states and mobile behavior.**
- [ ] **Step 5: Run a UI simplicity review against the spec guardrails:** one manager Messages destination, few primary buttons, no database jargon, no unnecessary admin-style navigation in manager portal.
- [ ] **Step 6: Run all manager communications, handoff, acknowledgment, incident/receipt regression tests; frontend typecheck; API build; web build.**
- [ ] **Step 7: Commit** `feat: complete manager operations inbox`.

### Task 10: Final integration, migration safety, and PR preparation

**Files:**
- Modify only files required by failed verification discovered in this task.
- No permanent temporary workflows.

- [ ] **Step 1: Verify current `main` and merge/rebase only if newer commits overlap these manager communications/handoff files.**
- [ ] **Step 2: Run database schema creation/migration tests twice** to prove idempotency and existing-data safety.
- [ ] **Step 3: Run full focused backend suite** for manager auth, messaging, handoffs, acknowledgments, receipts, incidents, crew notes/history, and notifications.
- [ ] **Step 4: Run full focused frontend suite** for manager shell/messages/action center/admin communications plus route/handoff regressions.
- [ ] **Step 5: Run `pnpm --filter @workspace/adventure-zone typecheck`, API production build, and web production build.**
- [ ] **Step 6: Confirm no temporary GitHub Actions files remain and no private object URLs/bucket paths are exposed in UI/API payloads.**
- [ ] **Step 7: Open a draft PR summarizing the simple manager UX, admin visibility, meetup approval bridge, acknowledgments, attachment filing, and verification. Do not merge without explicit user instruction.**
