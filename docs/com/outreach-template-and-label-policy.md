# Com outreach templates and profile labels

The shared policy in `artifacts/api-server/src/features/email-next-step-review.ts` is supplied through MCP initialization, the in-app assistant, profile-history results and relevant connector tool descriptions. Refresh the connector after deployment and verify in a new review.

## Resulting behavior

- Read the actual owner-approved current promo source before a batch. Keep its HTML structure, images, animation, package destinations, foam banner and approved commercial wording. Personalize the intended text only.
- Vendor-route questions, restrictions and existing inflatable coverage do not authorize switching an outreach to a short inquiry. Explicit routing-only requests and approved reply/follow-up formats remain valid.
- Use the owner's planned mailing date for a 30-calendar-day prepaid offer. October 5, 2026 gives November 4, 2026. Draft edits and review dates do not reset the confirmed deadline. A review reminder does not schedule email.
- Compare template sections and destinations before saving; read back the actual saved draft. Do not mark work ready based only on a successful save or valid MIME.
- File through the Command Center assignment workflow using its mapped label ID under Profiles/. Do not create top-level event labels or infer CRM association from Gmail labeling alone.

## Evidence and limits

The October 3 review paged all 117 draft-ready 2027 booking activities; 22 explicitly described restoration of the full promo. This confirms repairs, not the full original content or the reasoning that produced it. Live Gmail inspection found 54 top-level event labels, 52 empty. Burro Days and Colfax Marathon held three messages in total. Gmail did not provide label creation dates or actors; attribution remains unknown.

This change strengthens instructions; it is not a server validator for drafts saved through the separate Gmail connector. It does not rename, delete or reconcile production labels or modify CRM mappings. The normal label resolver already creates canonical Profiles/ paths. Existing cleanup only considers obsolete labels within recognized profile roots and cannot repair top-level aliases. A dedicated cleanup must inspect mapping ownership, preserve message and attention state, and account for ambiguous event names before applying changes.

## Verification

Evaluated the policy declaration section as JavaScript and checked that both the full instructions and tool/history reminder contain the new policy. Local shell and test execution were unavailable because the execution server failed sandbox provisioning. CI and a live fresh-connector drafting check remain necessary.

Live acceptance cases after deploy/refresh:

1. Given the approved promo and a vendor-route question, save the full promo with that question in its personalized text; preserve all approved assets and links.
2. Given an unavailable approved template, report the blocker instead of saving a substitute or marking work ready.
3. Given a Monday October 5 mailing instruction, preserve November 4 after a Saturday review and do not claim an email is scheduled.
4. Given a mapped profile and a top-level alias, use the app mapping and report cleanup limitations; create no new top-level label.
5. Given an explicitly requested routing-only email or a customer reply, use that authorized format.

Nothing in this policy authorizes sending, scheduled sending, form submission or granting new scopes.
