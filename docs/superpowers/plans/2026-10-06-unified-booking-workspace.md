# Unified Booking Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make booking work easier to find and read across Today, Emails, Profiles, and Schedule, and restore COM's ability to read website inquiries.

**Architecture:** Keep existing services and records as sources of truth. Add focused presentation adapters and a responsive shared email workspace; expose inquiry reads through the existing authenticated connection boundary. Deliver independently reviewable commits.

**Tech Stack:** TypeScript, React, Wouter, Tailwind, Vitest/Testing Library; Express, Zod, Drizzle, PostgreSQL and MCP.

**Spec:** `docs/superpowers/specs/2026-10-06-unified-booking-workspace-design.md`.
The redesign spec was approved in chat on October 6. Task 1 is the additional proposed bounded design for the subsequently reported website-inquiry issue, awaiting review together with this plan.
**Execution preference:** Retain Desiree's previously selected Native method; no paid Actions workflows.

## Global Constraints
- "The home screen is Today, with small groups rather than a mixed feed."
- "Use four primary booking destinations: Today, Profiles, Emails, and Schedule & Routes."
- "Linking reuses the existing mapped Profiles label without duplicates and preserves Inbox. Archive is an explicit action."
- "Navigating, linking, reviewing, or changing status never implicitly sends."
- "Use Needs Attention as the canonical attention label."
- "Preserve existing deep links."
- "Preserve current route planner rollout flags and configuration prerequisites."
- Preserve approved HTML templates, exact saved MIME and durable send ledger; no dependency additions or permission expansion.
- Inquiry tool access is read-only under existing crm:read; no conversion, archive, status changes, or sends.

## Review Focus
1. Account changes while a detail request is pending must not show or mutate the previous account's thread (Task 3).
2. Old review links with attentionMessage/profileId must open the intended context, not discard identifiers (Task 2).
3. Returning from a thread/profile on Fold must restore filter, selection, and scroll, including reload (Task 3).
4. Multiple task sources for the same event must deduplicate only the same action, retaining different actions (Task 4).
5. Revoked connections and malformed inquiry cursors must fail before repository access (Task 1).

## File roots
Frontend paths beginning `src/` in Tasks 2-5 are relative to `artifacts/adventure-zone/`. Connector paths are relative to `artifacts/api-server/` as specified. Existing services are retained; only the targeted review-dashboard extraction is a structural refactor.

## Source findings
Main baseline: d376f2152700bab3c59d118ae7e4da394fbd1fea.
The website inquiry browser routes support list/detail, but ConnectionServices, connectionTools and runtime wiring contain no inquiry service. Browser route authentication accepts owner/office sessions rather than connection OAuth tokens. Implement connector reads using authenticated services; do not weaken browser authentication.
EmailsPage currently owns mailbox and layout state. GoogleValidationReview is a large independent dashboard. Extract focused review list/detail units and retain its legacy wrapper for other consumers.

## Task 1: Read-only website inquiries for COM
**Files:** Create `artifacts/api-server/src/features/chatgpt-connection/website-inquiry-reads.ts` and `website-inquiry-reads.test.ts`; modify sibling `tool-registry.ts`, `connection-runtime.ts`, `mcp-server.test.ts`.
**Interfaces:** `WebsiteInquiryReads(db: SqlQuery, review: Pick<WebsiteInquiryReviewService, "list" | "detail">, appOrigin: string)`; `list(p: ConnectionPrincipal, input: {status?: WebsiteInquiryStatus; cursor?: string; limit?: number})`; `detail(p: ConnectionPrincipal, input: {inquiryId: string})`. Return existing inquiry fields plus an app URL and pagination; detail returns original message and audit history, marking source text as untrusted data. Do not omit message text silently.
- [ ] Write failing service and discovery tests: list defaults to 25, max 100, all five existing statuses; detail returns actual message/linked IDs; missing ID gives a structured not-found result. Invalid cursor/UUID and limits fail validation; a revoked connection or missing crm:read makes zero review-service calls.
- [ ] Run `pnpm --filter @workspace/api-server test -- src/features/chatgpt-connection/website-inquiry-reads.test.ts src/features/chatgpt-connection/mcp-server.test.ts`; confirm failures are missing inquiry support.
- [ ] Implement strict Zod schemas using parseWebsiteInquiryCursor. Each service method calls requireConnectionScope and activeConnection before reads. Register `list_website_inquiries` and `read_website_inquiry`, both readOnly=true, destructive=false, scope=crm:read; wire the existing DrizzleWebsiteInquiryRepository/WebsiteInquiryReviewService in connection-runtime. Generate links as appOrigin + /website-inquiries?inquiry=<encoded inquiryId>, matching WebsiteInquiryInbox.
- [ ] Rerun the tests; assert the catalog has both read tools and no inquiry mutation tools. Preserve existing owner/office browser-route authorization.
- [ ] Commit as `fix: expose website inquiry reads to COM`. After deployment and tool refresh, verify list/detail read-back without changing a real inquiry.

## Task 2: Four destinations and compatible review routing
**Files:** Modify `artifacts/adventure-zone/src/components/navigation/app-shell.tsx`, `mobile-bottom-nav.tsx`, `app-menu.tsx`, `src/lib/admin-workspace.ts`, `src/App.tsx`, `src/pages/EmailReviewPage.tsx`; test existing navigation tests plus new `src/components/navigation/unified-booking-navigation.test.tsx`.
**Interfaces:** New `src/features/emails/email-workspace-state.ts` exports `EmailWorkspaceView = "inbox" | "sent" | "drafts" | "review" | "needs_reply" | "waiting"` and `readEmailWorkspaceState(search: string): EmailWorkspaceState`. State includes view, query, threadId, draftId, profileId, attentionMessage and selected review message ID as optional strings.
- [ ] Write failing navigation tests asserting exact four primary destinations, Today home, mobile Schedule label, More retains secondary tools, and /email-review query identifiers survive redirect to /emails?view=review. Include boss/office access tests.
- [ ] Run `pnpm --filter @workspace/adventure-zone test -- src/components/navigation src/App.office-routing.test.tsx`; verify expected failures.
- [ ] Implement navigation and the state parser. Keep assistant/operations/marketing/admin links in secondary navigation. Replace EmailReviewPage with a compatible redirect preserving query parameters; do not grant booking access to office/boss-only accounts.
- [ ] Run the same tests plus `src/pages/EmailReviewPage.test.tsx`; update legacy expectations to the approved route behavior, retaining identifier assertions.
- [ ] Commit as `feat: unify booking navigation`.

## Task 3: One responsive email workspace
**Files:** Modify `src/pages/EmailsPage.tsx`, `src/components/google-workspace/google-validation-review.tsx`; create `src/features/emails/email-workspace.tsx`, `email-list.tsx`, `email-reader.tsx`, `email-review-pane.tsx`, `email-workspace.test.tsx` and `email-workspace-state.test.ts` under artifacts/adventure-zone. Reuse mailbox-client, Google review services and EmailAttentionControls.
**Interfaces:** `EmailWorkspace(): ReactElement` owns account-aware asynchronous state. `EmailList({items: MailboxMessage[], selectedId?: string, onSelect: (item: MailboxMessage) => void}): ReactElement`; `EmailReader({thread: MailboxThread | null, loading: boolean, error?: string, actions: ReactNode}): ReactElement`; `EmailReviewPane({selectedMessageId?: string, onSelect: (messageId: string) => void, onChanged: () => void}): ReactElement`. Review pane renders original review records and existing create/ignore/filing actions, with archiving explicit.
**Saved attention views:** Add a bounded read list to `artifacts/api-server/src/features/google-workspace/email-thread-attention-service.ts`, its repository and `src/routes/email-thread-attention.ts`: GET /list, query {gmailConnectionId: UUID, state: needs_your_reply | waiting_for_their_reply, cursor?: string, limit: 25 (max 100)}. `list(actor: AttentionActor, input): Promise<{items: AttentionRecord[]; nextCursor: string | null}>` checks active account ownership using the existing read path, sorts updatedAt/id descending and binds the cursor to account/state. No schema migration or Gmail mutation. Owner middleware remains mandatory. Add service/repository and route tests for wrong accounts, paging, invalid cursor and revoked Google connections.
- [ ] Add failing tests for all six view selections; review opens in reader context; source errors render retry rather than empty-inbox success; delayed responses after account/selection changes are ignored. Test no API mutation from selection, Back, or switching views.
- [ ] Test saved draft/template/MIME flow, visible To/Cc/Bcc/attachments, explicit send confirmation, and uncertain-send lockout. Test link preserves Inbox and review filing remains labeled as archiving.
- [ ] Run `pnpm --filter @workspace/adventure-zone test -- src/features/emails src/components/google-workspace/google-validation-review.test.tsx src/components/google-workspace/google-validation-review-create-profile.test.tsx`; verify new failing behavior.
- [ ] Extract mailbox ownership from EmailsPage without changing backend send/link contracts. Extract review list/detail rendering behind the legacy wrapper; move label-cleanup tools to secondary controls. Use the bounded saved-attention list for reply/waiting views, not guessed Gmail labels. Read the selected full thread through mailbox-client.
- [ ] Implement layout: below 768px one pane; 768-1279px list+reader with profile drawer; at 1280px and above list+reader with optional profile panel. Use minmax(0, ...) columns, reader as widest column, 44px minimum main tap targets, subdued separators, and one action bar. Store selection/filter in URL and account-keyed scroll/drawer state in session storage; ignore stale context belonging to another account.
- [ ] Run new and existing review tests and `node --test scripts/profile-email-native.test.cjs`. Manually check 390x844, 768x900 and 1440x900: no horizontal overflow, keyboard focus, Back and reload restoration, long subjects, HTML threads and attachment failures.
- [ ] Commit as `feat: consolidate emails and review workspace`.

## Task 4: Small Today groups
**Files:** Create `src/features/today/group-master-work.ts`, `group-master-work.test.ts`, `src/components/today/grouped-work-section.tsx`; modify `master-work-queue.tsx`, `src/pages/TodayPage.tsx` and their existing tests.
**Interfaces:** `groupMasterWork(queue: MasterTodayQueue): { replies: MasterWorkItem[]; calls: MasterWorkItem[]; booking: MasterWorkItem[]; waiting: MasterWorkItem[]; completed: MasterWorkItem[] }`; `GroupedWorkSection({title: string, items: MasterWorkItem[], onOpen: (item: MasterWorkItem, filter: string) => void}): ReactElement`.
- [ ] Test reply/draft/review mapping, callback/follow_up mapping, remaining kinds in Booking Work; waiting state collapsed unless actual actionable inbound work exists; completed never active. For identical source/action identity prefer review over draft over reply; keep a call and paperwork for the same event separate.
- [ ] Test five-row previews and Show all in place; pinned/manual order retained before urgency/due ordering, compact empty states, action/reason/date fields, and return restoration. Keep actual scheduled calls distinct from overdue generic follow-ups.
- [ ] Run `pnpm --filter @workspace/adventure-zone test -- src/features/today/group-master-work.test.ts src/components/today/master-work-queue.test.tsx src/pages/TodayPage`; verify failures.
- [ ] Implement display grouping over existing records and replace duplicate Today preview sections while retaining their task controls in the appropriate group/secondary expansion. Load masterQueue from the existing authenticated GET /today response; do not create tasks or infer inbound mail solely from outbound dates.
- [ ] Rerun tests and existing today-focus/outreach/call tests. Verify collapsed waiting, later, COM-in-progress and completed areas and unchanged route-planner disabled copy.
- [ ] Commit as `feat: group Today booking work`.

## Task 5: Profile context and Schedule entry cleanup
**Files:** Modify `src/components/profiles/simple-full-profile.tsx`, `profile-call-brief.tsx`, `src/pages/SchedulePage.tsx`, `src/components/schedule/schedule-view-toggle.tsx`; create `src/components/profiles/profile-activity-history.tsx` and `profile-activity-history.test.tsx`.
**Interfaces:** `ProfileActivityHistory({profileId: string, eventYear?: number, readOnly: boolean}): ReactElement` reads existing notes/email/activity sources, renders a single chronological view, and references original IDs. Call brief stays the first profile content section; existing field schemas and source indicators stay intact.
- [ ] Add failing tests for call facts before expanded paperwork, consolidated history with duplicate source IDs removed, same-date distinct activities preserved, and email/profile return links. Test boss read-only and absent price/date source handling.
- [ ] Run `pnpm --filter @workspace/adventure-zone test -- src/components/profiles/profile-activity-history.test.tsx src/components/profiles/simple-full-profile.boss-parity.test.tsx src/pages/SchedulePage`.
- [ ] Implement folded booking/paperwork sections and history using existing services; retain legacy ?section=emails/documents/notes behavior. Group calendar/routes/leg-capacity access under Schedule; preserve URL season/leg/status filters and unknown/unverified capacity wording.
- [ ] Rerun targeted profile, schedule filters and booking-leg tests; verify flags and API availability rules unchanged.
- [ ] Commit as `feat: connect profile context and schedule tools`.

## Task 6: Whole-change validation and delivery
**Files:** Modify this plan checkboxes and `docs/website-inquiry-inbox-runbook.md` with read-tool deployment/refresh steps.
- [ ] Run relevant frontend suites, connector suites, `pnpm --filter @workspace/adventure-zone typecheck`, `pnpm --filter @workspace/adventure-zone build` and `pnpm --filter @workspace/api-server typecheck`. Re-run native mailbox behavioral tests. No paid Actions workflow.
- [ ] If the complete dependency tree is unavailable, report each unrun check accurately and use available behavioral tests; do not mark build/typecheck passed.
- [ ] Review all acceptance checks in the spec across desktop and Fold, old routes, office/boss/owner permissions and no unintended email/inquiry mutations. Record actual outcomes and remaining limitations.
- [ ] Perform Native's fresh whole-branch review, correct findings, then create reviewable product PRs separated from this design/plan draft. Do not claim deployment until merged and verified live.

## Plan self-review
Spec sections map to Tasks 2-5; error/account/permission requirements map to Tasks 1-3 and 6. Existing mailbox invariants are exercised rather than rewritten. All five Review Focus cases have owning tests. COM link/archive parity and route activation remain separate follow-ups as the approved spec requires. Task 1 adds only the requested missing read path and requires review of this concrete proposed interface.
