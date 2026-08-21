# Booking Assistant Command Router and Audit Jobs Design

## Goal

Expand General Command Center from a search-first assistant into a safe command-oriented assistant that can understand and execute read-only CRM work such as audits, verification, research, reports, and discovery without treating every natural-language request as a profile search.

The assistant should still use the existing deterministic profile-search path for simple lookup requests, while routing broader instructions into explicit, bounded capabilities. Read-only work may begin immediately. Any action that changes CRM data must require explicit user approval after the assistant shows the proposed changes.

The initial flagship capability is a website audit:

> Make sure the profiles/events that have websites, the website works and matched the profile its attached to.

That request should start a read-only audit rather than return `I couldn't find a matching profile or event`.

## Product rules

1. **Understand commands, not only searches.** General Assistant requests are classified before retrieval.
2. **Read-only work starts immediately.** Searches, audits, verification, reports, and research can begin without an extra confirmation click when their scope is clear enough to execute safely.
3. **Writes always require approval.** No CRM mutation occurs merely because the user said `check`, `audit`, `research`, `find`, `verify`, `clean up`, or similar wording.
4. **Bulk approval is supported.** High-confidence proposed fixes may be approved in one batch, for example `Apply 29 verified fixes`.
5. **Ambiguous changes stay untouched.** Medium/low-confidence findings remain in a review queue rather than being silently changed.
6. **Long work must not freeze the app.** Large audits run in bounded batches through a persistent job model with progress and partial results.
7. **Reuse existing machinery.** Reuse the existing Lead Scout / research-job patterns, URL safety logic, canonical profile matching, progress UI concepts, and background-worker infrastructure where practical rather than creating an unrelated job subsystem.
8. **Deterministic capabilities outrank free-form AI.** The model may interpret language into a bounded schema, but it cannot generate arbitrary SQL, unrestricted filters, or arbitrary mutations.

## Command routing

General Command Center should route every request through a small command router before falling back to the existing profile-search behavior.

Suggested intent classes:

```ts
export type AssistantCommandKind =
  | "search"
  | "audit"
  | "research"
  | "report"
  | "change"
  | "question";
```

The router returns a bounded command envelope:

```ts
export type AssistantCommand = {
  kind: AssistantCommandKind;
  capability: string;
  originalText: string;
  scope: AssistantCommandScope;
  parameters: Record<string, unknown>;
  risk: "read_only" | "proposes_changes" | "writes_data";
  confidence: "high" | "medium" | "low";
};
```

`capability` must map to a registered server capability. It is never arbitrary executable text.

Examples:

- `Find Morton County Fair` -> `search/profile_lookup`
- `Who needs follow-up?` -> `report/overdue_followups`
- `Check all websites and make sure they match the profile` -> `audit/website_verification`
- `Find profiles missing phone numbers` -> `audit/missing_contact_data`
- `See which fairs have announced 2027 dates` -> `research/event_date_refresh`
- `Find duplicate organizations` -> `audit/duplicate_profiles`
- `Research missing official websites` -> `research/official_website_discovery`
- `Change all verified broken websites` -> `change/apply_audit_fixes`, which still requires an approval step before mutation.

### Routing order

1. Detect known high-confidence deterministic command patterns.
2. If needed, use cloud AI only to classify the request into the bounded command schema.
3. Validate that the requested capability exists and that its scope/parameters are permitted.
4. Execute the relevant deterministic capability.
5. Fall back to profile search for search-like requests.
6. Fall back to normal assistant Q&A only if no operational capability matches.

The model must never directly issue SQL, raw repository calls, or mutations.

## Scope model

Commands need explicit scope so phrases such as `all profiles`, `these results`, `this event`, or `Minnesota fairs` are not handled inconsistently.

Suggested scope:

```ts
export type AssistantCommandScope =
  | { kind: "all_applicable" }
  | { kind: "current_profile"; recordId: string }
  | { kind: "current_results"; resultSetId: string }
  | { kind: "record_ids"; recordIds: string[] }
  | { kind: "structured_filter"; filter: AssistantSafeFilter };
```

`AssistantSafeFilter` is an explicit allow-listed schema for supported fields such as region, event type, status, date window, package history, or missing field. It is not arbitrary SQL/filter syntax.

If a request's scope is genuinely ambiguous and the wrong interpretation could create a very large or misleading job, the assistant should ask one concise clarification. Otherwise read-only work starts immediately.

## Capability registry

Operational commands should be implemented as registered capabilities with a common interface.

Conceptually:

```ts
export type AssistantCapability = {
  id: string;
  kind: AssistantCommandKind;
  risk: "read_only" | "proposes_changes" | "writes_data";
  supportsBackgroundJob: boolean;
  execute(command: AssistantCommand, actor: ActorContext): Promise<AssistantCapabilityResult>;
};
```

The registry provides one auditable place to control what the assistant can do.

Initial capabilities should include:

### Existing / fast-path

- `profile_lookup`
- `profile_filter_search`
- `overdue_followups`
- existing Lead Scout discovery/research flows

### New audit/research capabilities

- `website_verification`
- `missing_contact_data`
- `duplicate_profiles` where existing duplicate/canonicalization logic can support it
- `event_date_refresh`
- `official_website_discovery`

The first implementation should prioritize the command router plus `website_verification`; the common framework should make later capabilities incremental rather than requiring another architectural rewrite.

## Website verification audit

### Scope

For each applicable organization/event/profile with a non-empty website URL:

1. Normalize the URL safely.
2. Attempt a bounded HTTP check with existing URL-safety / SSRF protections.
3. Follow permitted redirects with a strict limit.
4. Record reachability and final canonical URL.
5. Evaluate whether page evidence appears to belong to the attached Command Center profile.
6. When the saved URL is broken or clearly wrong, optionally search for a likely official replacement using the existing research/search provider infrastructure.
7. Produce findings and proposed changes; do not mutate the profile.

### Website status

Suggested status values:

```ts
export type WebsiteAuditStatus =
  | "verified_match"
  | "reachable_uncertain"
  | "likely_mismatch"
  | "broken"
  | "redirected"
  | "replacement_found"
  | "needs_review";
```

### Match evidence

Matching should use conservative signals such as:

- normalized event/organization name,
- known alternate/event-family names,
- city/state/region,
- venue or organizer references,
- contact/email domain,
- page title / structured metadata,
- recurring event identity clues.

Do not require every field to match. Do not label a page wrong merely because a current-year date is absent or the official site uses a parent organization domain.

### Confidence

Each finding should include a confidence level and concise reasons:

```ts
export type WebsiteAuditFinding = {
  recordId: string;
  recordLabel: string;
  savedUrl: string;
  finalUrl: string | null;
  status: WebsiteAuditStatus;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  suggestedUrl: string | null;
  sourceRefs: string[];
};
```

High-confidence replacement examples:

- saved site is dead and an official city/fair/organizer page clearly names the same event and location;
- saved URL redirects permanently to the same organization's canonical official domain;
- a typo/bad legacy domain is replaced by an official site with matching identity evidence.

Medium/low-confidence replacements are never eligible for one-click bulk apply.

## Persistent audit jobs

Large commands should create a persisted assistant job instead of being executed synchronously in the request/response cycle.

Prefer extending/reusing the existing Lead Scout job concepts and worker infrastructure, while keeping the domain records separate enough that an audit is not falsely represented as a lead-scout run.

Suggested general job model:

```text
assistant_jobs
assistant_job_items
assistant_job_findings
assistant_change_proposals
```

If the existing research-job tables and worker abstractions can be safely generalized, reuse those abstractions instead of duplicating queues/status logic.

### Job states

```text
queued
running
stopping
stopped
complete
failed
```

A job stores:

- id,
- actor/user id,
- command kind/capability,
- original instruction,
- normalized command JSON,
- status,
- current stage,
- progress counts,
- started/completed timestamps,
- cancel requested timestamp,
- bounded failure summary.

### Batch behavior

The website audit should process records in bounded batches so the API remains responsive. A slow/broken site must not hold the entire run hostage.

Each item should have timeout/retry limits. Failures become findings rather than crashing the entire audit unless the shared provider/system itself is unavailable.

### Progress

The drawer should show useful operational progress, for example:

```text
Website audit
Checking profile websites                 418 / 1,214
Verified                                  332
Broken                                     27
Possible mismatch                          11
Needs review                               48
```

Partial findings appear as they complete.

Closing the drawer does not cancel the job. Reopening General Command Center restores the active/recent job.

A running job offers `Stop`. A stopped job preserves completed work and may offer `Continue` where the capability supports resume.

## Result presentation

Completed audit results should be summarized by actionable categories rather than dumping hundreds of cards into the drawer at once.

Example:

```text
Website audit complete
1,214 checked
963 verified
71 broken
34 likely mismatches
29 verified replacements available
117 need review
```

Actions can include:

- `View broken`
- `View mismatches`
- `Review fixes`
- `Apply 29 verified fixes`
- `Export/view all results` if an existing report surface supports it

Result lists must paginate/virtualize or otherwise remain bounded on mobile.

## Proposed changes and approval

Audit jobs may create `assistant_change_proposals`, but those proposals are not CRM edits.

Suggested proposal shape:

```ts
export type AssistantChangeProposal = {
  id: string;
  jobId: string;
  recordId: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  status: "proposed" | "approved" | "applied" | "rejected" | "failed";
};
```

### Bulk approval rule

Only high-confidence proposals that satisfy the capability's explicit safety policy may be included in a bulk approval action.

Example:

> **29 high-confidence website fixes are ready.**
> `Review fixes` | `Apply 29 verified fixes`

Clicking `Apply 29 verified fixes` is the explicit approval event. The server then applies exactly that immutable proposal set, subject to optimistic concurrency checks.

The assistant must not silently add new proposals to an already-approved batch.

### Stale-data protection

Before applying a proposal, verify the field still has the expected old value. If another user changed it after the audit, mark that proposal `failed/stale` and leave the current value untouched.

### Medium/low confidence

These remain in a manual review list with actions such as:

- `Use suggested website`
- `Keep current website`
- `Open profile`
- `Open source`

No bulk auto-apply for ambiguous findings.

## Drawer behavior

### Fast commands

Simple profile search and small structured reports may answer immediately using the existing assistant result-card UI.

### Long commands

For a large read-only command, the assistant should immediately acknowledge what it understood and begin work:

> **Website audit started**
> Checking every applicable profile with a saved website. I’ll verify that the site loads and appears to belong to the attached event/profile. Nothing will be changed without your approval.

No `Run audit` confirmation is required for clearly read-only work.

### Mutation requests

If the user asks for a write directly, the assistant can prepare the proposed change set but must present an explicit approval action before applying it.

The assistant should distinguish:

- `I checked these` — work completed, no writes;
- `I found 29 fixes` — proposals exist;
- `29 fixes applied` — only after explicit approval and successful server mutation.

## Error handling

- Unknown command: fall back to search/Q&A rather than inventing a capability.
- Low-confidence classification: ask one concise clarification if execution could be materially wrong.
- One website times out: record that item as failed/needs review and continue.
- Search provider unavailable: complete reachability checks and clearly mark replacement discovery as unavailable.
- Worker restarts: persisted job resumes/retries safely.
- Duplicate execution: jobs and mutation batches use idempotency/unique identifiers.
- Stale proposal: skip and surface it rather than overwriting newer CRM data.
- Authorization failure: no job or mutation is executed.

## Security and privacy

1. Existing admin/owner authorization remains mandatory.
2. Manager Assistant does not gain unrestricted admin CRM audit powers.
3. URL requests use existing SSRF/network safety protections and bounded redirects/timeouts.
4. The model receives only the bounded data necessary to classify/match, not unrestricted CRM exports.
5. No arbitrary SQL or arbitrary field mutation is exposed to the model.
6. Every applied change is attributable to the approving actor and originating job/proposal.
7. Audit evidence should store bounded facts/provenance rather than complete scraped web pages.

## Testing

### Router

Tests must prove that:

- `Find Morton County Fair` uses profile search;
- `Check all websites` routes to website audit;
- wording variants such as `verify our event websites` and `make sure the websites belong to the right profile` map to the same bounded capability;
- unsupported commands do not become arbitrary operations;
- ambiguous high-impact scope triggers clarification rather than a guessed job.

### Read/write boundary

Tests must prove that:

- read-only audits begin without confirmation;
- audit completion never mutates CRM fields;
- proposed fixes require an explicit approval request;
- unapproved proposals remain unchanged;
- approved high-confidence batch updates only the exact proposal set;
- stale old values are not overwritten;
- medium/low-confidence proposals are excluded from bulk apply.

### Website audit

Cover:

- healthy matching official site,
- valid redirect to canonical site,
- timeout/dead site,
- obvious wrong event/location,
- parent-organization domain that is still a valid match,
- replacement official site found,
- weak replacement evidence -> needs review,
- URL safety rejection,
- one-item failure does not fail entire batch.

### Jobs/UI

Cover:

- large audit creates a persistent job,
- progress updates without blocking normal app use,
- partial results render,
- closing/reopening drawer restores job,
- stop preserves completed findings,
- resumable jobs continue from unfinished work,
- mobile result lists remain bounded,
- final summary counts match persisted findings.

## Release sequence

### Phase 1

- Add command router / capability registry.
- Preserve existing profile search as a fast path.
- Add generalized persistent assistant-job abstraction by reusing current Lead Scout worker/progress patterns where possible.
- Implement website verification audit.
- Add findings/results UI.
- Add proposed website changes and high-confidence bulk approval.

### Phase 2

Add additional capabilities through the same registry:

- missing contact-data audit,
- duplicate-profile audit,
- official-website discovery,
- current-year/event-date refresh,
- email-domain/website consistency checks,
- stale-contact/follow-up reports.

Phase 2 capabilities should not require another fundamental assistant architecture change.

## Success criteria

The feature is successful when the user's original website instruction starts a real read-only audit instead of being treated as a failed profile search; the app remains responsive while the audit runs; results explain what was verified or questionable; high-confidence fixes can be approved in one batch; ambiguous items stay untouched; and future audit/research commands can be added through the same bounded capability framework.