# Convention workspace verification

This change builds on the verified Early Bird recovery in PR #785. It adds owner and Boss convention views, yearly editions, durable member records, editable plan notes, guarded imports, explicit profile matching, review notes, archival, annual rollover, and links from existing profiles.

Profile history reads the existing activity, follow-up, applied convention-note, and canonical Early Bird records. Offers retain their actual event year and original calendar deadline. History is explicitly shown across all profile years; it is not automatically attributed to a convention. The convention feature neither sends messages nor creates a second promotion lifecycle.

Verification:

- 10 focused API/domain/database tests passed, including import retries, ambiguous matches, stale edits, archival, rollover isolation, Boss access boundaries, and profile offer dates.
- 3 screen tests passed, covering replacement/special-handling visibility, owner plan editing and failure recovery.
- API and web production builds passed.
- Repository typechecks still report existing errors; none were reported in the new convention files.
- Private import preview reconciled 274 entries across six convention lists, with all 231 outreach-queue records represented and all 304 research sources retained. All 274 records pass the import validator. Customer data is not in this PR.

Remaining release steps: review/merge the recovery and this change, verify migration and screens on the deployed app, then select the convention years and run the live profile-match previews before importing. Unmatched entries remain in the lists for explicit linking; no new CRM profiles are created automatically. Email replies and campaign membership are not automatically assigned to a convention; the owner updates the list classification and outcomes while existing profile history remains available.
