# Early Bird Promo Design

**Date:** September 9, 2026
**Status:** Approved
**Product:** Adventure Zone Command Center

## Goal

Run a seasonal Early Bird Promo that encourages earlier deposits without making each message sound like a private discount. Applicable customer sales emails sent through March 31, 2027 advertise 10% off when the deposit is received by a specific date. The displayed date is calculated as 30 calendar days after the first qualifying email is sent.

The application tracks the customer-specific clock internally, surfaces the offer on the event profile, and prepares a reminder halfway through the window when the customer has expressed interest but has not paid a deposit.

## Customer wording

The initial promotional block uses general campaign language:

> **Early Bird Promo:** For a limited time, The Adventure Zone is offering 10% off bookings when deposits are received by **{{offerDeadline}}**.

The generated draft replaces `{{offerDeadline}}` with a fully formatted date, such as `October 9, 2026`. It must never leave an unresolved placeholder in a submitted or sent message.

The midpoint reminder uses:

> Just a reminder—our Early Bird Promo ends **{{offerDeadline}}**. Submit your deposit by then to receive 10% off and secure your event date.

The wording must not say that the offer was created exclusively for the recipient. It also must not claim a universal or company-wide eligibility rule beyond the truthful statement that The Adventure Zone is running the named promotion.

## Campaign rules

- Campaign name: `Early Bird Promo`.
- Discount: 10% of the eligible booking subtotal.
- Qualifying action: deposit received by the saved deadline. A signed contract is not separately required to qualify unless the business later changes the rule.
- Campaign availability: qualifying emails sent from the activation date through March 31, 2027.
- Recipient deadline: 30 calendar days after the first qualifying promotional email is actually sent.
- A March 31, 2027 send receives the full 30-day window even though the deadline falls in April.
- The first qualifying sent email starts the clock. Drafting, previewing, submitting for approval, or scheduling an email does not start it.
- Later emails reuse the saved deadline and never extend or restart it.
- Only one open Early Bird Promo enrollment may exist for the same event/booking.
- Offers do not stack automatically with another discount. Conflicts require owner review.

## Email scope

The promotional block is included in customer-facing booking and sales messages during the campaign:

- new-event introductions;
- state-fair outreach;
- previously attended/rebooking outreach;
- active sales follow-ups;
- every current pre-convention, during-convention, and post-convention sales template when the recipient is still a prospect, including the existing interactive/rich convention designs;
- package information and smaller-package options; and
- budget/space sales responses when a booking remains possible.

It is excluded from:

- deposit-received and signed-contract confirmations;
- COI, insurance, and operational-document requests;
- decline acknowledgements;
- post-event thank-yous;
- holiday messages;
- internal emails; and
- messages for events whose deposit is already recorded.

The server, rather than each individual template, owns this scope so one rule controls both seeded templates and future approved sales templates.

For the current convention templates, the Early Bird Promo block appears near the booking call to action and before the template footer/signature. It preserves the existing images, animation, mobile layout, and convention-specific personalization fields. The insertion is idempotent: a template or draft that already contains the current promotion cannot receive a duplicate block. The 10% Early Bird Promo is the only discount inserted automatically; the proposed 12% convention discount is not added or stacked.

## Stored promotion enrollment

Add a booking/event-scoped enrollment record rather than overloading the reusable commercial-offer definition. It stores:

- event/organization and booking identifiers;
- commercial offer rule identifier;
- first qualifying email and Gmail/message identifiers when available;
- first sent timestamp;
- calculated deadline;
- interest state and the message/evidence that established it;
- reminder due timestamp;
- reminder draft and follow-up identifiers;
- deposit-received timestamp and source;
- status: `active`, `secured`, `expired`, or `cancelled`; and
- audit timestamps.

Create a separate owner-approved commercial-offer rule, `early_bird_promo_2026_2027`, for the percentage, calculation scope, relative deadline, and no-automatic-stacking policy. Keep the existing `early_bird_10_percent` rule unchanged as a proposed, source-derived note; activating or rewriting it would erase the distinction between historical source material and this explicitly approved campaign. The per-event enrollment is the durable record of what was offered to a particular customer.

All creation and transition operations are idempotent. Replayed Gmail sync events or send callbacks must not create duplicate enrollments, reminders, drafts, or profile follow-ups.

## Send and rendering flow

1. A user prepares an applicable customer sales email.
2. The server determines whether the Early Bird Promo is available and whether the event already has an active enrollment.
3. Before the first send, the draft may preview a prospective deadline but clearly identifies it as calculated from the eventual send date.
4. On confirmed send, the server atomically creates the enrollment, saves the send timestamp, and calculates the deadline as 30 calendar days later.
5. The sent message contains the resulting calendar date. If the email provider workflow cannot guarantee the final date before transmission, the server must finalize the body before handing it to Gmail and then persist the same value after Gmail accepts the send.
6. Later qualifying messages render the saved deadline.
7. The profile timeline receives an audited `Early Bird Promo sent` entry and shows the active deadline.

Date calculations use the application business timezone (`America/Chicago`). The saved customer deadline is an inclusive business calendar date, while expiration is represented by the start of the following business day. Calendar-day addition must remain stable across daylight-saving transitions.

## Interest and midpoint reminder

The reminder is relevant only when both conditions are true:

- an inbound reply expresses booking interest; and
- no deposit has been recorded for the event.

A Gmail-derived interest classification may suggest the state, but an uncertain classification cannot send mail. Existing explicitly approved `interested` opportunity state also qualifies. When interest becomes confirmed, the enrollment records the evidence and sets the reminder due time to 15 calendar days after the original promotional email—not 15 days after the reply.

At or after that due time, the system creates exactly one reviewable reminder draft and one linked profile follow-up. It places the work in the Today workspace and the Boss approval workflow. It never sends automatically.

If interest is first confirmed after day 15 but before expiration, the reminder becomes due immediately and still uses the original deadline. If interest is confirmed after expiration, no reminder is created.

## Deposit, expiration, and cancellation

Recording a deposit from any trusted app workflow marks the enrollment `secured`, records its source and timestamp, and closes any open reminder follow-up. An unsent reminder draft is cancelled or clearly marked obsolete so it cannot be sent accidentally.

At the deadline, an unpaid enrollment becomes `expired`. The profile retains the history and deadline but removes the promotion from newly generated sales email text. Expiration does not send an automatic email.

Users with appropriate permissions may cancel an enrollment with a recorded reason. Cancellation also closes pending reminder work.

## Profile and workspace presentation

The event profile shows a compact Early Bird Promo card with:

- the saved deadline;
- status;
- first email sent date;
- whether interest has been confirmed;
- reminder state; and
- deposit state.

The timeline records the meaningful transitions. The Today and Boss queues link directly to the event profile and prepared reminder. Dave or Desiree can edit and approve the reminder before sending it through the established email workflow.

## Failure handling

- A failed email send does not start the offer clock.
- A successful provider send with a failed local write enters a reconciliation queue keyed by the provider message ID.
- Missing or ambiguous profile matching prevents automatic enrollment and creates a review item.
- Missing deposit linkage does not silently expire a secured offer; conflicting evidence is surfaced for review.
- Reprocessing the same email or reply is safe and produces no duplicates.
- The promo block is omitted when eligibility cannot be established safely.

## Alternatives considered

### Template text only

Adding a dated sentence to templates would be faster, but it would leave deadline, reply, reminder, and deposit tracking manual. It risks missed follow-ups and inconsistent dates, so it is not recommended.

### Automatic reminder sending

The system could send the midpoint reminder as soon as Gmail classifies a reply as interested. That saves a review step but could send an inappropriate discount message after an ambiguous reply. Reviewable drafts are safer and match the existing Boss approval workflow.

### Tracked enrollment with reviewable reminder — selected

This approach preserves a firm date, prevents deadline resets and duplicate reminders, integrates with profiles and Gmail history, and keeps a human in control of outgoing messages.

## Testing and acceptance criteria

- An applicable email sent during the campaign contains the Early Bird Promo wording and a date exactly 30 calendar days after send.
- Previewing or saving a draft does not start the window.
- A second applicable email for the same event displays the original deadline.
- Every current pre-, during-, and post-convention sales template includes exactly one Early Bird Promo block without changing its existing rich design or mobile behavior.
- Non-sales and already-paid messages contain no promotion.
- Emails after March 31, 2027 do not create new enrollments.
- A March 31 send receives a deadline 30 days later.
- Confirmed interest creates one day-15 reminder when no deposit exists.
- A reply arriving after day 15 creates an immediately due reminder if the offer remains active.
- No interest, an expired offer, or a received deposit creates no reminder.
- Recording a deposit secures the offer and closes/cancels pending reminder work.
- Gmail event replay creates no duplicate enrollment, draft, follow-up, or timeline entry.
- Failed sends do not start the clock; provider/local reconciliation repairs partial success safely.
- The profile, Today workspace, and Boss review workflow show consistent status and dates.
- Customer-facing copy never exposes the internal phrase `30 days` and never presents the promotion as an individualized private discount.

## Out of scope

- Automatically sending reminders.
- Automatically stacking this discount with convention, repeat-customer, or discretionary discounts.
- Applying the promotion retroactively to earlier emails.
- Changing deposit amounts, invoicing, or payment-provider behavior.
- Automatically renewing the campaign for future seasons; a later season requires an explicitly reviewed campaign window.
