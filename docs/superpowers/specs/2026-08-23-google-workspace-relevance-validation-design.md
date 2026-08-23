# Google Workspace Relevance Validation Design

**Status:** Approved in chat on 2026-08-23

## Goal

Prevent business/profile-relevant Gmail from being left behind simply because it lives outside one of the manually approved business label trees, while still avoiding a wholesale copy of the entire mailbox into the Command Center.

## Core rule

A Gmail message may enter the CRM when deterministic evidence shows that it is business-related or connected to an existing CRM profile/contact/organization/booking, regardless of which Gmail system/custom label currently contains it.

Messages that are clearly unrelated remain outside the durable CRM archive. Messages that appear business-related but cannot be confidently connected become visible review items instead of being silently discarded.

## Discovery vs storage

The system separates **discovery metadata** from **durable CRM content**:

1. Gmail may be scanned broadly using read-only metadata needed to evaluate relevance: message/thread IDs, label IDs, participants, subject, date, headers/snippet, and attachment/file presence.
2. Deterministic relevance rules run before durable message-body/file storage.
3. Full body/attachment storage is allowed only after the item is classified as business-relevant, profile-matched, or explicitly approved through review.
4. Clearly unrelated personal content is not stored in CRM content tables and is never sent to AI.

## Primary business signals

The existing selected business roots remain strong positive evidence:

- Shows
- Receipt
- Off Season Business Opportunities
- Employees
- Associations
- Spam

Additional business-family labels such as `Potential shows`, `BUSINESS EXPENSES`, and `BANKING & LOANS` may contribute positive relevance evidence, but financial categories do not require a dedicated CRM finance view. They are useful only when they provide profile/business context.

## System labels

Gmail system labels such as INBOX, SENT, IMPORTANT, STARRED, UNREAD, TRASH, DRAFT, CHAT, category labels, and star labels are metadata/context signals. They do not make a message business-relevant by themselves.

Spam is special: it is explicitly searched so legitimate business/profile email misclassified by Gmail can still be discovered.

## Deterministic relevance evidence

An item is relevant when one or more strong deterministic signals exist and no explicit exclusion blocks it:

- sender/recipient/CC matches a saved CRM contact email;
- sender/recipient domain matches one uniquely approved organization domain and is not a generic public-mail provider;
- thread/message has an existing approved profile/organization/booking association;
- selected/custom business label evidence exists;
- subject/headers contain an exact known event/profile/organization identifier from a bounded CRM candidate set;
- message is part of a thread already proven business-relevant;
- explicit owner/Office review previously marked the source/rule as business-related.

Weak content resemblance alone is not enough for automatic ownership.

## Review states

Each discovered item reaches one of these visible outcomes:

- matched business/profile item;
- business-related internal filing;
- needs review;
- ignored as unrelated;
- retry/error.

No ambiguous business-looking source should disappear merely because it lacks a selected Gmail label.

## Privacy and AI

- AI is disabled during the first validation sample.
- AI never receives clearly unrelated content.
- AI cannot establish source ownership.
- Only business-relevant/review-approved content may later be summarized or analyzed.

## Recent-history validation gate

Before historical backfill, the owner runs a bounded newest-first sample (initial target: 100 Gmail threads/messages plus recent Calendar items).

The validation screen shows:

- discovered count;
- automatically matched count;
- business-related but unmatched count;
- ignored/unrelated count;
- exact evidence used for every retained item;
- source labels/system-state context;
- profile/contact/organization candidate when applicable.

The sample must not write CRM profile fields. It may archive only the bounded sample sources needed for review. Full historical backfill remains disabled until the owner approves the sample.

## Access

- Administrator: full validation controls and evidence.
- Office Coordinator: later review access only after the owner enables the workflow; no Google credentials/scope controls.
- Leg managers: no Gmail metadata, content, validation, review, or derived notes.

## Rollout

1. Build deterministic metadata discovery and relevance classification.
2. Build bounded validation API and owner UI.
3. Run the 100-item sample with AI off.
4. Refine relevance/matching rules from the sample.
5. Only then proceed to durable historical Gmail/file archive and full backfill.