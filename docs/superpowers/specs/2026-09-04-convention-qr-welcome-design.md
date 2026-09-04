# Convention QR Welcome Design

## Goal

Give convention attendees a special welcome when they scan Dave's QR code while keeping them on the existing Adventure Zone homepage. The experience should feel exclusive, identify convention leads in the Command Center, and avoid advertising a discount that has not been activated by the owner.

## Entry URL and Trigger

The QR code will point to:

`https://www.the-adventure-zone.com/?welcome=convention`

The homepage custom element will read the `welcome` query parameter when it loads. It will open the convention welcome only when the value is exactly `convention`. The ordinary homepage URL and all other values will retain the existing experience.

The parameter remains in the address bar so the source is preserved through navigation and form submission. Closing the welcome does not remove it.

## Welcome Experience

The convention welcome is a branded modal layered over the homepage. It uses the site's existing navy, yellow, pink, white, typography, borders, and shadows. It must fit without horizontal scrolling on phones, including narrow and folding screens.

Content:

- Eyebrow: `CONVENTION EXCLUSIVE`
- Heading: `Welcome, Convention Guests!`
- Message: `Thanks for stopping by The Adventure Zone. We bring a fully staffed traveling inflatable carnival to fairs, festivals, rodeos, and major community events.`
- Offer message: `Convention attendees may qualify for exclusive booking savings. Tell us about your event to receive your convention offer.`
- Primary action: `CLAIM YOUR CONVENTION OFFER`
- Secondary action: `EXPLORE THE SITE`
- A standard close button with an accessible label

The welcome must not state `12%`, promise eligibility, set a deadline, or imply that the offer combines with other discounts. The live commercial-offer record is still Proposed, restricted to qualifying new customers, exclusive of other discounts, and awaiting an owner-approved deadline.

## Interaction

The welcome appears once per page load when the exact query parameter is present. It does not appear on ordinary visits.

`CLAIM YOUR CONVENTION OFFER` closes the modal and scrolls the visitor to the existing inquiry form. `EXPLORE THE SITE`, the close button, and the Escape key close it without scrolling. Clicking outside the modal also closes it. While open, focus remains within the modal and the page behind it does not scroll.

The experience respects reduced-motion preferences. The entrance may use a short fade and scale animation for other visitors.

## Inquiry Attribution

When `welcome=convention` is present, inquiry submissions use the existing website-inquiry endpoint and form behavior, with additional convention attribution in the submitted data. The preferred representation is a structured source value if the current endpoint already accepts one; otherwise a clearly labeled note such as `Lead source: Convention QR` is appended to a compatible message or metadata field.

The visible inquiry content and sender details remain unchanged. The Command Center must still run its existing duplicate/profile-match suggestions. Convention attribution must be visible in the inquiry review without requiring a new CRM subsystem.

If attribution cannot be accepted by the current endpoint, the form still submits normally and shows its existing success or error state. The site must not block a lead because optional source metadata failed.

## Implementation Boundaries

- Reuse the existing homepage custom-element bundle, styles, and inquiry form.
- Do not create a separate Wix page.
- Do not change the regular homepage experience.
- Do not activate or edit commercial-offer rules.
- Do not publish an exact discount percentage or deadline.
- Do not change the wacky mascot, package cards, team bubbles, or other unrelated sections.
- The QR destination change is handled separately after the updated site is published.

## Verification

Automated checks should cover query parsing, convention-only visibility, close behavior, CTA scrolling, and convention attribution in the inquiry payload. Existing homepage and inquiry tests must continue to pass.

Browser verification should confirm:

1. The ordinary homepage does not show the welcome.
2. `?welcome=convention` shows the welcome on desktop and mobile.
3. Both actions and the close affordances work.
4. The primary action reaches the inquiry form.
5. A test inquiry reaches the Command Center with convention attribution while retaining duplicate/profile-match behavior.
6. The popup has no overflow, clipped text, or oversized cards on narrow and folding screens.
7. The final published URL works before Dave's QR destination is updated.

