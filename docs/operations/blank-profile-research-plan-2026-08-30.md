# Blank Profile Research Plan — August 30, 2026

## Baseline

The protected live profile-integrity audit found **442 active profiles with no linked operational information**: no contacts, appearances/bookings, timeline history, open follow-ups, matched Gmail threads, or operational calendar links.

Phase 0 addresses the seven profiles without ACT company provenance:

- Four known empty test records are eligible for guarded removal only when the exact ID, name, expected location, blank content, lack of ACT source, and lack of linked records still match at deployment time.
- Three real organization records are retained, verified, enriched, and given source-dated research notes and justified follow-ups:
  - Colorado Events
  - Idaho Department of Fish and Game
  - Te-Moak Tribe of Western Shoshone

After Phase 0, the remaining working set is **435 ACT-backed profile shells**.

## Working-set shape

| Region/status | Blank ACT-backed profiles |
| --- | ---: |
| Colorado | 111 |
| Montana | 77 |
| Idaho | 70 |
| Utah | 40 |
| Arizona | 40 |
| Wyoming | 37 |
| Nevada | 16 |
| South Dakota | 4 |
| Washington | 4 |
| North Dakota | 2 |
| Missouri | 1 |
| Missing location/region | 30 |
| Malformed region/location value | 3 |
| **Total** | **435** |

The malformed values found in the audit are `80424`, `LOGAN CANYON UT`, and `ID 83544`.

At 25 profiles per working batch, the remaining set requires **18 batches**. The first two batches should absorb the 33 missing/malformed-location records so the overall work remains within those 18 batches.

## Order of work

### Phase 1 — Location and identity triage

Start with the 33 records whose location is missing or malformed.

For each record:

1. Read the exact ACT company name and source identifier.
2. Search the live app for aliases, duplicates, parent organizations, locations, or event-family matches.
3. Search ACT-imported notes/calls and Gmail for city, state, organizer, domain, or prior recipient clues.
4. Use current official sources to resolve the identity and location.
5. Classify the record as verified, duplicate/merge candidate, renamed, inactive, organization umbrella, event, territory hold, or unresolved.
6. Do not guess a location simply to clear the queue.

### Phase 2 — Highest-yield operating states

Process the profiles most likely to become useful Adventure Zone leads first:

1. Colorado — 111
2. Idaho — 70
3. Wyoming — 37
4. Utah — 40
5. Nevada — 16

Use geographic clusters within a state when possible so nearby events, organizers, chambers, fair boards, and routes can be compared together.

### Phase 3 — Remaining core-volume states

Continue with:

1. Montana — 77
2. Arizona — 40

### Phase 4 — Edge-state cleanup

Finish with the 11 records in South Dakota, Washington, North Dakota, and Missouri. These can be combined into the final batch after the larger state queues are complete.

## Required workflow for every profile

Use the following order. Do not skip ahead to public research or outreach before checking internal history.

1. **Live app identity check**
   - Search exact name, shortened name, city/county, alternate spellings, ACT-style names, and likely parent organizations.
   - Check duplicate and location-family candidates.
   - Never create a cleaner-looking duplicate merely because the ACT name is awkward.

2. **Full internal history review**
   - Read ACT notes, calls, imported activities, contacts, bookings, follow-ups, and relationship records.
   - Preserve the newest meaningful relationship status.

3. **Adventure Zone Gmail review**
   - Search exact and alternate names, prior contacts, recipient emails, and organization domains.
   - Check sent mail, replies, and existing drafts.
   - Record whether outreach occurred, whether anyone replied, and whether the current contact differs from the historical contact.

4. **Current official-source research**
   - Prefer the official event, organizer, fairgrounds, city, chamber, tribe, school, or agency site.
   - Verify whether the entity/event is active, current name, location, website, phone, organizer, contact path, event dates when applicable, and family-entertainment fit.
   - Use reputable local sources only to fill a gap left by official sources.

5. **Territory and fit check**
   - Apply the standing territory holds for New Mexico, Oregon, California, Kansas, Oklahoma, and Texas before normal outreach work.
   - Separate an unsuitable event from a useful parent organization. An agency, tribe, association, or producer may be worth retaining even when no generic sales email should be sent.

6. **CRM classification and update**
   - Choose one: enriched active profile, event appearance needed, parent/umbrella organization, duplicate/merge candidate, renamed, inactive/historical, territory hold, bad contact, unresolved identity, or no-fit.
   - Add a source-dated note explaining the evidence and confidence.
   - Update verified name, city/state, type, website, phone, address, and contact information.
   - Preserve historical contacts and relationship evidence instead of replacing them without explanation.

7. **Next-action decision**
   - Create a follow-up only when a future action is genuinely justified.
   - For an umbrella organization, the next action should usually be to identify a specific event and event-level organizer—not to send a generic pitch.
   - Do not create routine annual tasks for structural blocks, permanent no-inflatable policies, dead entities, or unsupported leads.

8. **Outreach boundary**
   - Research and CRM cleanup do not automatically authorize a Gmail draft.
   - Draft only when the event, contact, fit, relationship angle, dates, and package availability are verified.
   - Update an existing draft rather than creating a duplicate.
   - Never send without a separate explicit instruction.

## Batch review output

Each 25-profile batch should end with a compact review showing:

- Profiles fully enriched
- Event appearances/child records needed
- Duplicate or merge candidates
- Renamed or inactive records
- Territory holds
- Profiles with no authoritative contact
- Profiles needing a human call or identity decision
- Follow-ups created and why
- Profiles intentionally left without a follow-up
- Any existing 2026 outreach or drafts discovered

One ambiguous profile must not stop the rest of the batch.

## Definition of complete

A profile is complete enough to leave the blank-profile queue when it has:

- A resolved identity and location, or a documented reason they cannot yet be resolved
- A current official website/source path when one exists
- A verified phone/contact path, or an explicit note that no authoritative contact was found
- An active, renamed, inactive, umbrella, territory-hold, duplicate, or unresolved classification
- Its ACT and Gmail relationship status recorded
- A duplicate/location-family decision
- A justified next action—or an intentional no-follow-up decision
- No invented email address, phone number, title, event date, or relationship history

## Immediate next batch

After Phase 0 deploys and the live audit confirms the seven no-ACT shells are resolved, begin with the **33 missing/malformed-location records**, filling the remainder of the second 25-profile batch with Colorado records. Then continue through Colorado in geographic clusters.
