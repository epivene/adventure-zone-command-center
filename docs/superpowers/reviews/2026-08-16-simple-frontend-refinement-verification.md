# Simple Frontend Refinement Verification Notes

Date: 2026-08-16

## Manual audit completed

- Profile slide-in uses `place.name` instead of falling back to generic `Profile`.
- Open full closes the detail sheet before Wouter navigation.
- Main profile tabs are Overview / Notes / Events.
- Raw system/imported history remains available under a collapsed History section with filters.
- Common ACT field-change history is converted to plain-language labels deterministically.
- Dropdown surfaces use opaque white backgrounds and elevated z-index.
- Profile search keeps advanced filters behind a Filters disclosure and shows active filter chips.
- Event Families are collapsed by default; Suggest families and Find duplicates are grouped at the bottom.
- Mobile calendar is a compact seven-column month grid with selected-day details.
- ACT calendar activity is off by default.
- Alternate calendar view is Upcoming with progressive Show more.
- CalendarPage now passes the current active month back to EventCalendar, fixing the original-month snapback during repeated month navigation.
- Schedule filters are compacted behind a disclosure.

## Automated verification limitation

GitHub Actions previously refused to start because the repository/account reported failed recent payments or a spending-limit issue. This is an infrastructure/billing block rather than a test failure. Keep the follow-up PR in draft until tests/typecheck/build can execute or the deployed preview is manually exercised.
