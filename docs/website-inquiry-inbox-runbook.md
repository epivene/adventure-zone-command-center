# Website Inquiry Inbox Runbook

This runbook moves the Adventure Zone website from the paid Replit runtime to the existing Render services. It also connects the public contact form to the Command Center inquiry inbox without creating CRM records automatically.

## Approval gates

Stop at every gate. Approval for one stage does not approve a later stage.

1. **Push and Render deployment:** obtain explicit approval before pushing the branch or changing the Render deployment.
2. **Wix edit:** after Render is verified, obtain explicit approval before changing the Wix custom-element source or deleting the diagnostic element.
3. **Wix publish:** after Preview is verified, obtain explicit approval immediately before publishing.
4. **Production inquiry:** publishing does not authorize submitting the production smoke inquiry. Obtain explicit approval before sending it.
5. **Stop Replit:** ask separately after the Render site, published Wix page, inbox, alert, and archived smoke inquiry are verified.

## Local verification

From the `command-center` repository, run:

```powershell
pnpm --filter @workspace/db build
pnpm --filter @workspace/api-server test -- src/features/website-inquiries src/routes/public-website-inquiries.test.ts src/routes/website-inquiries.test.ts
pnpm --filter @workspace/adventure-zone exec vitest run src/features/website-inquiries src/website-custom-element/adventure-zone-site.contract.test.ts src/components/office/office-shell.test.tsx src/components/navigation/app-shell.test.tsx src/components/navigation/app-menu.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx src/App.office-routing.test.tsx
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/api-server build
pnpm --filter @workspace/adventure-zone build
git diff --check
```

## Render configuration and checks

The services used by this integration are:

- API: `https://adventure-zone-command-center.onrender.com`
- Static web host: `https://adventure-zone-command-center-1.onrender.com`
- Hosted custom element: `https://adventure-zone-command-center-1.onrender.com/adventure-zone-site.js`

Configure these API-service environment variables in Render:

```text
WEBSITE_INQUIRY_ALLOWED_ORIGINS=https://the-adventure-zone.com,https://www.the-adventure-zone.com
WEBSITE_INQUIRY_ALERT_RECIPIENTS=<comma-separated owner/admin and Amy notification addresses>
WEBSITE_INQUIRY_INBOX_BASE_URL=https://adventure-zone-command-center-1.onrender.com
```

Keep `WEBSITE_INQUIRY_ALERT_RECIPIENTS` in Render; never add its value to the repository or the public JavaScript.

After the approved deployment finishes, run these read-only checks:

```powershell
$health = Invoke-WebRequest -UseBasicParsing 'https://adventure-zone-command-center.onrender.com/api/healthz'
$health.StatusCode
$health.Content

$script = Invoke-WebRequest -UseBasicParsing 'https://adventure-zone-command-center-1.onrender.com/adventure-zone-site.js'
$script.StatusCode
$script.Headers.'Content-Type'
$script.Content.Contains('customElements.define("adventure-zone-site"')
$script.Content -match 'replit\.app'
```

Expected results: both requests return HTTP 200, health reports healthy, the script has a JavaScript content type, the custom-element check is `True`, and the Replit check is `False`.

## Grant Amy inbox access

Sign into the Command Center as the owner. Open **Account**, select Amy's Office account, turn on **Website inquiries**, and save. This grants Amy access by permission, not by matching her name. Confirm Amy can see **Website Inquiries** in Office navigation and that an Office account without the permission cannot see or open it.

## Connect the Wix custom element

Only do this after the Wix-edit gate is explicitly approved.

1. Open the Adventure Zone custom element in Wix.
2. Set **Source** to **Server URL**.
3. Enter the exact script URL:

   ```text
   https://adventure-zone-command-center-1.onrender.com/adventure-zone-site.js
   ```

4. Set the tag name to:

   ```text
   adventure-zone-site
   ```

5. Remove the temporary diagnostic element only after confirming it is the diagnostic copy and the real custom element renders.

## Preview without submitting

Open Wix Preview and do not send the contact form. Check desktop and mobile widths for:

- header and mobile menu;
- hero video and fallback images;
- About, Packages, How It Works, Safety, Booking Structures, Gallery, FAQ, and Contact sections;
- keyboard focus, FAQ controls, navigation anchors, and responsive height;
- contact fields and the submit button, without clicking Submit.

If Preview is correct, stop and obtain the separate Wix-publish approval.

## Production smoke inquiry

Only send this after Wix has been published and the production-inquiry gate is explicitly approved.

Submit exactly one inquiry from the production site with the event name or message clearly labeled:

```text
Website integration smoke test
```

Confirm:

1. The form shows a successful receipt and reference code.
2. The owner sees the inquiry and the new-count badge.
3. Amy sees it through her permitted Office inbox.
4. The detail view shows the message, audit history, match suggestions, and alert state.
5. No contact, organization, booking, or follow-up was created merely by the public submission.
6. Archive the smoke inquiry from the review screen. Do not convert it to CRM records.

## Rollback

If the hosted script or Wix integration fails, restore the previous Wix custom-element source and tag settings, then republish only with explicit approval. Do not delete the website inquiries table or its saved records; rollback of the page source must leave already received inquiries intact for review.

Keep Replit running during rollback and throughout verification. Stop the paid Replit deployment only after Render, the published Wix page, the production smoke inquiry, both authorized inbox views, notification delivery, and smoke-inquiry archival are confirmed—and only after a separate explicit approval.
