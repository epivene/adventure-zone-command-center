# Packages, Booking Assistant, and Manager Assistant Design

## Goal

Improve Adventure Zone Command Center by combining the public Adventure Zone website, structured booking/package rules, imported ACT! history/notes, route/leg context, and existing manager-portal operations into one practical system for booking staff and Leg Managers.

The design has three connected goals:

1. Make packages flexible and reflect how the family business actually books events.
2. Give booking staff an assistant that understands customer history, packages, routes, follow-ups, and prior outcomes.
3. Give Leg Managers a permission-scoped operational assistant that can answer routine questions and escalate unanswered questions to admins.

The system must remain useful with unreliable connectivity. Core guidance and previously synced business data should work offline; heavier cloud AI should enhance the experience when available rather than being required for basic work.

## Source-of-truth hierarchy

Command Center should distinguish between source material and operational truth.

### Structured Command Center data

Structured records are the primary operational source of truth for:

- contacts and organizations,
- event families,
- bookings,
- package selections,
- resource assignments,
- leg assignments,
- routes,
- calendar dates,
- follow-ups,
- manager instructions,
- admin answers,
- acknowledgments.

The assistant may summarize or interpret these records but must not silently rewrite them.

### ACT! history and notes

Imported ACT! history and notes are historical evidence. They are useful for identifying:

- prior packages,
- recurring dates,
- who the customer normally speaks with,
- prior pricing or objections,
- reasons a booking was won/lost,
- typical follow-up timing,
- unusual operational requirements,
- repeated preferences.

Raw imported text should remain preserved. Cleaner summaries, extracted facts, and assistant-generated insights should link back to source records.

### Adventure Zone website

The public website is a business-knowledge source for package descriptions, customer-facing language, attraction types, site/setup requirements, and general operating expectations.

Website content should seed or suggest package knowledge, but it must not rigidly define a booking. The family business customizes events frequently, so package and attraction selections remain editable.

## Package model

### Package meaning

A package represents a normal event scale/type and target attraction range, not a locked list of specific inflatables.

The same named package can contain different equipment from one event to another.

Initial package concepts include:

- Adventure Zone,
- Warrior's Playground,
- Pirate's Rebellion.

Package names and rules are admin-editable so future offerings do not require code changes.

### Target ranges are guidance, not hard limits

The business generally builds from familiar package sizes, but larger or unusual combinations are valid.

Initial operating defaults should be configurable and start approximately as:

- Adventure Zone: normal main-attraction target of 10-12,
- Warrior's Playground: around 5,
- Pirate's Rebellion: around 3.

These values are not enforced maximums. The UI may warn when a configuration is unusual, but it must not block a booking simply because it is above or below the normal range.

Examples:

- `Adventure Zone · 11 / target 10-12` — normal.
- `Adventure Zone · 14 / target 10-12` — allowed, with a soft note to confirm equipment/leg capacity.
- `Pirate's Rebellion · 4 / target 3` — allowed.

Admins can edit min/target/max-guideline values or convert an exact default into a range later.

### Multiple packages on one booking

A booking may contain multiple package sections.

Example:

- Adventure Zone: 11 main attractions,
- Pirate's Rebellion: 3 main attractions,
- carnival games: 4,
- paintball trailer: add-on/shared resource.

Each package section keeps its own target range and assigned attractions. The booking also shows one combined operational resource summary.

Package counts should not be blindly summed into one inferred physical count when the same physical resource is shared/attributed across packages. Resource assignments remain the physical source of truth.

### Main attractions, games, and special resources

The package editor should distinguish between:

1. **Main attractions** — the primary inflatable/competitive/wet attractions used for package target ranges.
2. **Carnival games / extras** — tracked separately from the main-attraction target.
3. **Special/shared resources** — trailers or equipment such as paintball that require independent availability and transfer/conflict tracking.

Paintball should generally remain a separate shared resource rather than behaving like an ordinary bounce-house count. It may be associated with a package while retaining its own schedule/location/conflict logic.

### Editable package templates

Admins can edit:

- package name,
- active/inactive state,
- normal attraction range,
- default/suggested attractions,
- default games/extras,
- customer-facing description,
- booking-staff talking points,
- operational/site requirements,
- setup notes,
- tags/categories.

Default attractions are suggestions only. Event-specific equipment is freely editable.

### Historical package comparison

When a customer/event has prior bookings, Command Center should surface relevant comparisons such as:

- "They normally book Adventure Zone + Pirate's Rebellion."
- "Last year had 12 main attractions; this draft has 9."
- "Paintball was included last year but is not selected this year."
- "This organization usually books in July."

These are advisory signals, not automatic mutations.

## Assistant architecture

Use a hybrid local-first design with two layers:

1. **Deterministic Command Center intelligence** for facts, comparisons, rules, warnings, and structured summaries.
2. **Language-model assistance** for conversational explanation, summarization, drafting, and more complex reasoning.

The deterministic layer should answer as much as possible without requiring an LLM. This makes the system faster, cheaper, more reliable, and more useful offline.

### Why not cloud-only

Cloud-only AI would fail in poor connectivity and would unnecessarily send routine questions off-device.

### Why not local-only

A small local model is appropriate for short summaries and conversational presentation but may not handle long ACT! histories, broad cross-account analysis, or sophisticated drafting as well as the existing cloud AI API.

### Recommended hybrid behavior

- Offline: use synced structured data, cached knowledge, deterministic rules, saved summaries, and an optional local model.
- Online: use the same local/context layer first, then selectively call the cloud AI API for heavier requests.
- The UI clearly indicates when an answer is based only on offline/cached data.

## Booking Assistant

### Audience and permissions

The Booking Assistant is available to admins/booking staff with the same permissions as the signed-in user.

It may use authorized access to:

- profile/contact data,
- organization/event-family data,
- ACT! notes and history,
- cleaned summaries/extracted facts,
- booking history,
- package history,
- follow-ups,
- call outcomes,
- calendar data,
- route/leg proximity and availability,
- relevant admin knowledge.

It must not bypass normal authorization simply because the AI endpoint can access the database.

### Persistent assistant entry point

The main application gets a persistent Assistant button/drawer.

The assistant is also context-aware on major screens:

- profile,
- organization,
- event family,
- booking,
- Today/call workspace,
- calendar event,
- route/leg.

Opening the assistant from a record automatically attaches that record context so the user does not need to restate what they are viewing.

### Booking Brief

Profiles/bookings should expose an automatic concise Booking Brief before the user asks a question.

Typical brief fields:

- likely/previous package mix,
- last meaningful outcome,
- prior event dates/timing,
- typical attraction count,
- last known contact/person,
- important objections or promises,
- outstanding follow-up,
- route/leg fit where relevant,
- differences from prior year,
- suggested next action.

The brief should prefer plain language over ACT! system terminology.

### Example questions

The assistant should support questions such as:

- What happened with this customer last year?
- Why did we lose them in 2024?
- What do they normally book?
- What is different from last year's booking?
- What should I ask when I call?
- What am I forgetting?
- Would Pirate's Rebellion make sense here?
- Which previous note says they wanted paintball?
- What follow-up should happen next?
- Draft a follow-up email based on the last conversation.

### Evidence and sources

Important claims/recommendations should expose a Sources/Why control.

Examples:

- historical note(s),
- prior booking(s),
- package configuration,
- call outcome,
- route/calendar facts,
- website-derived package knowledge.

The assistant should distinguish:

- known structured fact,
- extracted historical fact,
- inference/recommendation.

This is especially important while ACT! data is still being cleaned and normalized.

## Manager Assistant

### Purpose

Leg Managers receive a simpler Operations Assistant focused on completing assigned work safely and efficiently.

It should not become a backdoor into the full sales CRM.

### Manager-visible context

The assistant may use only information the manager is already authorized to see, including:

- assigned leg,
- assigned events,
- package/equipment summary,
- approved route/calendar information,
- setup/teardown schedule,
- site/location information,
- operational customer contact details needed for the event,
- manager instructions,
- approved handoffs/meetups,
- equipment notes,
- relevant acknowledgments,
- reusable operations knowledge.

It must not expose unrelated customer sales history, private notes, pricing strategy, other legs, or admin-only CRM data.

### Example questions

- What time should we arrive?
- Which equipment is assigned to this event?
- Does this site need water?
- Do we need a forklift for load-out?
- What did admin say about setup access?
- Where is our next event?
- Is paintball transferring to another leg after this?
- What do I still need to acknowledge?

### Contextual placement

The Manager Assistant is available from a persistent portal button and contextual event/leg pages.

Opening from an event automatically scopes the conversation to that event unless the manager intentionally switches context.

## Admin Question escalation

### When escalation happens

If the Manager Assistant cannot answer confidently from authorized data, it should not invent an answer.

It offers **Ask Admin**.

### Admin Question record

Submitting Ask Admin creates a structured Command Center record containing:

- manager/user,
- leg,
- event/booking where applicable,
- original question,
- timestamp,
- urgency if chosen/inferred,
- relevant authorized context snapshot/references,
- what sources/rules the assistant already checked,
- assistant's reason for escalation,
- status.

Suggested statuses:

- `needs_answer`,
- `answered`,
- `resolved`.

Urgency may be represented separately, e.g. normal/urgent.

### Admin inbox

Admins get one Admin Questions inbox integrated with existing manager communications/operations rather than a separate disconnected tool.

Admins can:

- answer,
- ask a follow-up,
- mark urgent,
- link/change the associated event or leg if needed,
- resolve,
- optionally promote the answer into reusable operations knowledge.

### Returning the answer

The manager receives the answer in the portal and the question remains associated with its event/leg for future reference.

If the answer changes official operational data, that change should follow the existing admin-change acknowledgment rules rather than treating the chat response itself as the official mutation.

### Reusable knowledge

Admins may explicitly save appropriate answers as reusable operational knowledge.

Do not automatically train/save every response. Some answers are event-specific or contain details that should not become general guidance.

Reusable knowledge should record:

- question/topic,
- answer,
- scope (global/package/resource/site/etc.),
- author/admin,
- effective date,
- optional expiration/review date,
- provenance back to the original question when applicable.

## Offline-first behavior

### Offline data scope

The app should cache only data the signed-in user is authorized to access and that is useful for near-term work.

Booking staff may cache a broader working set; managers should cache their assigned legs/events and relevant operations knowledge only.

### Offline-capable features

At minimum, previously synced data should support:

- viewing profiles/assigned events already cached,
- package target/rule calculations,
- historical comparison derived from cached records,
- booking/operations briefs generated from cached structured summaries,
- searching cached notes/summaries,
- asking deterministic assistant questions,
- viewing cached reusable knowledge,
- composing Admin Questions for later send.

An optional small local browser model can improve natural-language summaries/chat after its model files have been downloaded and cached.

### Cloud-enhanced features

When online, the assistant may use the configured AI API for:

- long-history summarization,
- multi-year relationship analysis,
- complex cross-record reasoning,
- high-quality email/message drafting,
- broad prioritization across many prospects,
- extraction/cleanup jobs that are too expensive for the local model.

### Connectivity UX

The assistant should show a simple state such as:

- Online,
- Offline - using saved Command Center data,
- Syncing.

It must not imply that offline answers include records that were never synced to the device.

### Offline queue

Admin Questions and other supported offline mutations should use the existing offline mutation philosophy:

- queued state,
- durable client-generated idempotency key,
- retry after reconnect,
- visible failure state,
- no duplicate question creation on retry.

## Knowledge extraction from ACT! history

The raw imported history is often verbose/system-oriented. Introduce derived, reviewable knowledge rather than replacing raw records.

Potential extracted facts include:

- recurring event month/date pattern,
- package names/attraction counts,
- contact preference,
- buyer/decision-maker,
- objections,
- promised follow-up,
- prior outcome,
- recurring special requirement,
- sentiment/relationship summary.

Each extracted fact should retain source record IDs and confidence/provenance.

Low-confidence facts should be phrased as possibilities and should not overwrite structured CRM fields automatically.

Admins may confirm/promote useful extracted facts into structured fields where appropriate.

## Website knowledge ingestion

The website should not be queried live on every assistant request.

Instead, create a small admin-maintained business knowledge layer seeded from the public website and current internal knowledge.

Useful categories include:

- package descriptions,
- attraction categories,
- setup requirements,
- water/power/site requirements,
- customer-facing FAQs,
- sales talking points,
- terminology.

Store source URL and last-reviewed date. Website-derived knowledge can then be updated deliberately when the public site changes.

## Data boundaries

Exact schema names should follow current repository conventions, but keep responsibilities separate.

Suggested concepts:

- package templates/ranges,
- booking package selections,
- booking package attraction assignments,
- business knowledge entries,
- assistant conversations/messages,
- assistant source references,
- derived CRM facts/summaries,
- admin questions,
- admin question responses,
- reusable operations knowledge,
- offline sync metadata where not already covered by the existing queue/cache systems.

Do not put all assistant state into one generic JSON table.

## Assistant safety and correctness rules

1. Never fabricate operational facts.
2. Never bypass user/manager authorization.
3. Clearly distinguish facts from recommendations.
4. Prefer structured records over AI-extracted guesses when they conflict.
5. Preserve raw ACT! source history.
6. Do not auto-edit CRM records from conversational inference.
7. Require explicit user action for meaningful mutations.
8. Escalate uncertain manager questions rather than guessing.
9. Never expose another leg/customer's restricted information through retrieval.
10. Keep AI-generated drafts visibly editable before sending.

## UI guardrails

The assistant must make Command Center simpler, not more crowded.

- One persistent assistant entry point.
- Contextual brief/prompt suggestions where useful.
- No separate "AI dashboard" required for ordinary usage.
- Package warnings use plain language and do not block unusual but legitimate family-business decisions.
- Manager assistant screens remain operational and mobile-first.
- Sources/Why details are available on demand rather than permanently filling the screen.
- Admin Questions fit into the existing manager communications/operations ecosystem.

## Testing strategy

### Packages

- package templates are editable,
- 10-12 Adventure Zone range is advisory rather than blocking,
- multiple packages can coexist on one booking,
- package equipment lists are independently editable,
- games/extras remain distinguishable from main attractions,
- paintball/shared resources retain conflict tracking,
- historical comparisons do not silently change the new booking.

### Booking Assistant

- context follows the current profile/booking/event,
- authorization is enforced server-side,
- structured facts beat conflicting inferred facts,
- sources are traceable,
- assistant cannot mutate records without explicit actions,
- offline answers contain only cached/synced context,
- cloud failure falls back gracefully where local functionality exists.

### Manager Assistant

- manager can only retrieve assigned/authorized operational context,
- unrelated CRM history is inaccessible,
- uncertain questions offer escalation,
- event context is attached automatically,
- official changes still create normal acknowledgments.

### Admin Questions

- offline retry is idempotent,
- admins receive the correct event/leg context,
- answering returns to the correct manager,
- reusable knowledge requires explicit admin promotion,
- resolution preserves question/answer history.

### Offline

- cached package rules remain available,
- cached briefs/history comparisons work without network,
- queued Admin Questions survive refresh/restart where supported by the existing offline store,
- UI clearly indicates offline mode,
- reconnect sync does not duplicate mutations.

## Implementation sequencing

This design should be implemented in releases rather than as one large feature.

Recommended order:

1. **Package rule correction and editable ranges** — adapt the existing package/resource model so ranges are soft guidance, improve multi-package presentation, and preserve special-resource tracking.
2. **Business knowledge + historical derived facts** — create the source-linked knowledge layer from website/ACT! history.
3. **Booking Brief + deterministic assistant context** — provide useful non-LLM intelligence first.
4. **Booking Assistant chat + cloud AI enhancement**.
5. **Manager Assistant with strict permission-scoped retrieval**.
6. **Admin Questions inbox and escalation loop** integrated with existing manager communications.
7. **Offline assistant enhancement/local model** after the deterministic offline path is stable.

This sequencing prevents the local-model work from delaying the operational value of the assistant.

## Out of scope for the first implementation plan

- autonomous outbound calls,
- automatically sending customer emails/texts without review,
- AI changing prices/contracts/bookings on its own,
- automatic training/fine-tuning from every manager conversation,
- full offline mirroring of the entire CRM database,
- replacing the existing manager communications system,
- building a second application/database,
- hardcoding website package contents as immutable inventory bundles.
