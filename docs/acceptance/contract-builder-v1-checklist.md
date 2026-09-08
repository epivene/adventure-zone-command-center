# Contract Builder v1 Acceptance Checklist

Status: Awaiting owner/legal copy approval

Rollout: `CONTRACT_BUILDER_ENABLED=false`

Template: `adventure-zone-standard` version 1 remains `reviewed`, not `active`

Do not activate the template or enable the feature until an owner records their name, review date, and a Pass result for every line below. Review the generated PDFs against the protected Gmail source attachments; do not copy those attachments into the repository.

## Source-copy comparison

Protected sources:

- `Meeteetse Annual Labor Day Celebration 2026 Contract.docx`, Gmail message `1a048f5b4dab9d4f`
- `Stone Age Stampede Dinosaur CO 2026.docx`, Gmail message `19c35c5a26d576ad`

Intentional normalizations to review:

- Event-specific party, venue, date, package, price, percentage, and signer values are typed fields rather than fixed source text.
- The event representative is always signer 1 and Dave Gordon is always signer 2.
- Guarantee-plus-percentage uses only the reviewed guarantee and percentage component clauses and states the percentage base explicitly.
- PDF typography, line wrapping, page numbers, and signature/date rules are normalized by the deterministic renderer; the legal obligations are not intentionally changed.

Reviewer: ____________________  Review date: ____________________  Result: [ ] Pass [ ] Fail

## Case 1 — Stone Age Stampede / Dinosaur, Colorado

Arrangement: guaranteed fee, deposit, and remaining balance

| Review item | Pass | Fail | Notes |
|---|:---:|:---:|---|
| Party names | [ ] | [ ] | |
| Venue and mailing address | [ ] | [ ] | |
| Event, arrival, and departure dates | [ ] | [ ] | |
| Guaranteed fee arithmetic: deposit + remaining balance = total | [ ] | [ ] | |
| Operational clauses | [ ] | [ ] | |
| Event representative is signer 1 | [ ] | [ ] | |
| Dave Gordon is signer 2 | [ ] | [ ] | |
| Two signature and date areas | [ ] | [ ] | |
| PDF opens and is readable | [ ] | [ ] | |
| Immutable version can be retrieved | [ ] | [ ] | |

Reviewer: ____________________  Review date: ____________________  Result: [ ] Pass [ ] Fail

## Case 2 — Meeteetse Annual Labor Day Celebration

Arrangement: pay-for-play and event percentage

| Review item | Pass | Fail | Notes |
|---|:---:|:---:|---|
| Party names | [ ] | [ ] | |
| Venue and mailing address | [ ] | [ ] | |
| Event, arrival, and departure dates | [ ] | [ ] | |
| Admission/ticket terms and event percentage | [ ] | [ ] | |
| Percentage base is explicit | [ ] | [ ] | |
| Operational clauses | [ ] | [ ] | |
| Event representative is signer 1 | [ ] | [ ] | |
| Dave Gordon is signer 2 | [ ] | [ ] | |
| Two signature and date areas | [ ] | [ ] | |
| PDF opens and is readable | [ ] | [ ] | |
| Immutable version can be retrieved | [ ] | [ ] | |

Reviewer: ____________________  Review date: ____________________  Result: [ ] Pass [ ] Fail

## Case 3 — Controlled duplicate test booking

Arrangement: guarantee plus percentage, composed only from reviewed component clauses

| Review item | Pass | Fail | Notes |
|---|:---:|:---:|---|
| Party names | [ ] | [ ] | |
| Venue and mailing address | [ ] | [ ] | |
| Event, arrival, and departure dates | [ ] | [ ] | |
| Guarantee, deposit, and balance arithmetic | [ ] | [ ] | |
| Event percentage and explicit percentage base | [ ] | [ ] | |
| Operational clauses contain no new legal wording | [ ] | [ ] | |
| Event representative is signer 1 | [ ] | [ ] | |
| Dave Gordon is signer 2 | [ ] | [ ] | |
| Two signature and date areas | [ ] | [ ] | |
| PDF opens and is readable | [ ] | [ ] | |
| Immutable version can be retrieved | [ ] | [ ] | |

Reviewer: ____________________  Review date: ____________________  Result: [ ] Pass [ ] Fail

## Signed agreement and COI recovery

| Review item | Pass | Fail | Notes |
|---|:---:|:---:|---|
| A valid signed PDF is stored as a new, unconfirmed revision | [ ] | [ ] | |
| Explicit confirmation marks only the selected PDF revision complete | [ ] | [ ] | |
| Contract completion is not rolled back by a Gmail failure | [ ] | [ ] | |
| Exactly one editable Gmail draft is created | [ ] | [ ] | |
| Draft recipient is Sara Toone, `sara@protectiveins.net` | [ ] | [ ] | |
| Draft contains exact additional-insured wording, dates, and certificate-holder address | [ ] | [ ] | |
| Gmail has no sent COI message from this workflow | [ ] | [ ] | |
| Repeating completion/retry does not create a duplicate draft | [ ] | [ ] | |
| Dave's signature remains stored only in Adobe | [ ] | [ ] | |

Reviewer: ____________________  Review date: ____________________  Result: [ ] Pass [ ] Fail

## Activation authorization

Owner approval recorded by: ____________________  Date: ____________________

- [ ] Every section above passed.
- [ ] Template version 1 may move from `reviewed` to `active`.
- [ ] `CONTRACT_BUILDER_ENABLED` may be set to `true` in the approved environment.
