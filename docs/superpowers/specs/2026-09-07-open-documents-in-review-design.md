# Open Documents In Review Design

## Goal

Let an owner inspect the actual protected file from a Business Documents review card before choosing a review action.

## Approved behavior

- Every pending review card has an **Open protected file** button.
- Clicking it calls the existing protected-document open endpoint with the review item's `documentId` and opens the returned short-lived URL in a new browser tab.
- Opening a file does not approve, defer, reject, or otherwise change the review item.
- While the URL is being requested, only that item's open button is disabled and reads **Opening…**.
- If the protected file cannot be opened, the review remains visible and an inline error explains that the file is unavailable.
- This feature reuses the existing API and requires no database or server change.

## Verification

Focused component tests cover successful opening and failure handling. After deployment, verify the button is present on a live review card and opens the protected file in a new tab.
