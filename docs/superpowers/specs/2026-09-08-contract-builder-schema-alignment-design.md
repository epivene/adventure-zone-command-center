# Contract Builder Schema Alignment Design

## Problem

The contract API validates and renders a detailed legal `ContractValues` model, while the tablet builder uses an obsolete simplified model. The builder therefore omits required questions and sends incompatible nested objects. Depending on the booking data, the mismatch causes a blank render, a failed autosave, or an unavailable Generate Contract button.

## Chosen approach

Make the API's legal contract model the single contract between client and server. The tablet will collect every field the validator and PDF renderer require. It will also normalize older partial drafts into that model in memory, allowing the existing draft to open and be completed without database cleanup.

We will not weaken server validation or translate the obsolete payload on the server. Those alternatives could create a PDF whose legal terms were never reviewed.

## Shared data contract

The frontend contract types will mirror the backend types:

- Event identity: organization, event and venue names, complete venue address, event dates, package selection, attraction count, and travel leg.
- Signers: event representative and Dave, including name, role, email, phone, and fixed signing order.
- Commercial terms: guaranteed fee, pay-for-play, or guarantee plus percentage, with the fields required for the selected arrangement.
- Operational terms: operating and travel dates, daily hours, work-day count, attraction and site requirements, utilities, lodging, restrooms, licensing, setup/teardown, additional terms, and explicit confirmation.
- COI: certificate holder, address, and additional-insured wording.

The client will keep a small exhaustive normalizer for partial legacy drafts. Defaults are blank or zero review values; they are not treated as confirmed legal facts. Arrangement changes will create the correct discriminated commercial-terms branch and preserve only compatible values.

## User experience

The builder remains one scrollable tablet page, grouped into:

1. Event and venue
2. Event representative
3. Commercial arrangement
4. Operating responsibilities
5. Certificate of insurance
6. Signing order and preview

The “Still needed” panel will show the server's field-specific messages after every save. Inputs will use dates, currency, percentages, numbers, checkboxes, and multiline text where appropriate. Autosave will debounce edits and display Saving, Saved, or an actionable error. Generate Contract remains disabled until the server reports the draft ready.

## Data flow and compatibility

1. Opening a draft returns the stored partial values and validation state.
2. The client normalizes missing nested fields for safe editing without claiming they were supplied.
3. An edit sends the complete current `ContractValues` payload with the expected revision.
4. The server validates and returns the updated revision plus field errors/warnings.
5. The client replaces both draft state and editable values with the returned snapshot.
6. Finalization uses the same validated snapshot for PDF generation and Adobe handoff.

Existing drafts remain usable. No destructive migration or automatic legal-field population is required.

## Error handling

- A malformed server payload shows a visible contract-load error rather than a blank page.
- Validation failures remain normal draft state and are shown by field/message.
- Revision conflicts ask the user to refresh rather than overwriting another session.
- Unexpected server failures retain the draft locally on screen and show a retryable save error.

## Testing

- Type/normalizer tests cover partial legacy drafts and every arrangement branch.
- Component tests verify all required questions render, arrangement switching produces the correct payload, and missing-package drafts can be edited.
- Page tests verify load, autosave revision updates, validation feedback, preview, and generation gating.
- Existing API validation, rendering, versioning, file, and COI suites remain green.
- Both frontend and API production builds must succeed before merge.

## Success criteria

- The Pirate Fest draft opens without a blank screen.
- Editing any visible field autosaves without a 503.
- Every backend-required field is editable or clearly displayed from profile data.
- The missing-details panel becomes field-specific after save.
- A fully completed draft enables Generate Contract and produces the existing PDF/Adobe handoff flow.
