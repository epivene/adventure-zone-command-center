# Owner-Only Adventure Zone Agent

**Approved:** August 31, 2026

## Goal

Replace the current collection of phrase-matched assistant paths with one consistent, auditable Adventure Zone agent that is available only to Desiree through the owner/admin workspace.

## Access boundary

- The owner agent and all administrator tools are server-authorized, not merely hidden in the interface.
- Exactly one active owner account exists: the primary owner account for Desiree.
- Office Coordinator and leg-manager credentials can never authenticate as the owner.
- The manager assistant remains a separate, leg-scoped helper and receives none of the owner agent's cross-CRM tools.
- Internal import credentials remain machine-only and cannot open an owner session.
- Every owner session is attributable to the stable owner account. The first foundation release can revoke all owner devices together through a session-version check; per-device session management is a later hardening option.

## Identity migration

The existing deployment uses `OWNER_PASSWORD`. The first successful owner login after this change may use that password to create the one database-backed owner credential. There is no registration endpoint and no way to create a second owner. Once the database credential exists, sign-in uses its salted password hash.

Legacy assistant data stored under the former blank owner actor namespace must remain available and be adopted by the stable owner identity as it is encountered or migrated.

## Agent behavior

The owner agent will receive the active page/profile context, the current conversation's earlier turns, relevant business rules, and a narrow registry of typed tools. It must not invent customer history, dates, contacts, pricing, package availability, route facts, or promises.

Read and research actions may proceed automatically. Explicit, reversible single-record corrections may proceed with a visible result and undo path. Inferred corrections become proposals. Destructive, financial, contractual, bulk, or outbound-send actions require explicit approval.

The first agent release will not expose an email-send tool. It may create or update drafts only.

## Initial tool families

- Search and read profiles, contacts, event families, aliases, notes, ACT history, calls, activities, drafts, follow-ups, Gmail evidence, calendar availability, package inventory, leg assignments, and travel conflicts.
- Research current public event and contact information and compare it with CRM records.
- Add or correct profile fields, notes, follow-ups, leg assignments, verified sources, and email drafts through narrow audited tools.
- Propose merges, deletes, confirmed-booking changes, uncertain contact replacements, contractual changes, and bulk corrections for owner approval.

## Business policy

The agent must enforce the approved Adventure Zone workflow, including alternate-name duplicate checks, territory holds before research, complete package-inventory counting, all-package outreach, draft-only email behavior, relationship-history grounding, current-contact verification, selective personalization, CRM hygiene after meaningful replies, and no sponsorship framing.

## Delivery sequence

1. Database-backed singleton owner identity and revoke-all owner sessions.
2. Persistent conversational memory for general and profile assistant modes.
3. Unified owner-agent runtime and read-only CRM tools.
4. Reversible write tools, approval cards, audit records, and undo.
5. Gmail, calendar, public research, and outreach-policy integration.
6. Acceptance/evaluation suite based on Desiree's real Adventure Zone requests.
7. Retirement of obsolete phrase-only paths after parity is proven.
