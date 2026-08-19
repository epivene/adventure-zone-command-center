# Compact profile + shared photo verification

- Default full profile changed to approved compact header + timeline layout.
- Ask Assistant appears immediately left of Edit.
- Follow-up state is represented by one card only: green = none open, amber = upcoming/needed, red = overdue.
- Contact, Events, and Notes remain the only count cards.
- Profile photo is editable, center-cropped and compressed client-side, then stored on the organization record so it is shared across sessions/devices.
- Photo API accepts JPEG/PNG/WebP data URLs only and rejects oversized payloads.

Verification is pending GitHub Actions execution on the follow-up PR.
