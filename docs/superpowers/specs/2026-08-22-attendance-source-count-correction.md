# Attendance Workbook Source-Count Correction

This note supersedes the attendance row/status counts written earlier in the 2026-08-22 Business Drive integration plan.

The earlier artifact preview stopped at spreadsheet row 126 and therefore omitted three valid October event rows. A full `artifact_tool` read of `Adventure Zone Attended Calendar.xlsx`, `Sheet1!A1:N129`, establishes the source-of-truth counts below.

## Correct full-workbook counts

- Event/month source rows: **110**
- Year-status cells: **198**
- `X = attended`: **189**
- `B = blacklisted`: **1**
- `C = cancelled last minute`: **8**

The omitted rows were:

- Row 127 — month `OCTOBER ` — event `Summit Games ` — location `Herriman UT` — 2024 `X`
- Row 128 — month `OCTOBER ` — event `Townsend Rotary Fall Fest` — location `Townsend MT` — 2024 and 2025 `X`
- Row 129 — month `OCTOBER ` — event `Two Mile High Club Fall Festival` — location `Cripple Creek CO` — 2024 and 2025 `X`

Together those rows explain the difference from the truncated preview: +3 event rows and +5 attended statuses.

## Source-preservation rules

The normalized fixture must preserve exact workbook strings and 1-based spreadsheet row numbers. This includes source trailing spaces and apparent source typos; matching may normalize them separately, but the original text must not be silently corrected.

Row 66 (`Pioneer Days - Logan`, `Logan UT`) is a valid event/month source row with no X/B/C status cells and therefore remains in the 110 source rows.

The workbook legend remains exactly:

- `X` → `attended`
- `B` → `blacklisted`
- `C` → `cancelled_last_minute`

`blacklisted` is historical attendance-source data only. It does not automatically set Do Not Call or another contact-preference flag.
