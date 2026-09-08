# Google Workspace Setup and Gmail Profile-Label Rollout

This procedure connects the Adventure Zone company Google account with least-privilege Gmail, Calendar, and Drive access, then safely enables Email Review profile labeling.

Phase 1 only establishes the secure connection and saves exact business-scope IDs. It does **not** import email bodies, attachments, Drive files, or Calendar events.

## 1. Keep production processing disabled

Deploy the foundation with these switches off:

```text
GOOGLE_WORKSPACE_SYNC_ENABLED=false
GOOGLE_WORKSPACE_AI_ENABLED=false
GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=false
```

The Phase 1 application does not start a Google historical worker, even if these values are accidentally present. Keep them false so later phases also begin safely.

## 2. Prepare the Google Cloud project

In the Google Cloud project owned or authorized for the business:

1. Enable the **Gmail API**.
2. Enable the **Google Calendar API**.
3. Enable the **Google Drive API**.
4. Open Google Auth Platform and configure the application branding, support contact, audience, and data access.
5. During testing, add the company Google account as an allowed test user when the selected audience requires it.
6. Create an OAuth client with application type **Web application**.

Do not create a Desktop client and do not use an out-of-band copy/paste flow.

## 3. Register the callback exactly

Add the public API callback as an authorized redirect URI on the Web application OAuth client:

```text
https://<COMMAND_CENTER_API_HOST>/api/google-workspace/oauth/callback
```

The value must match the deployed `GOOGLE_WORKSPACE_REDIRECT_URI` exactly, including scheme, host, path, and trailing-slash behavior. Production must use HTTPS on a domain the business owns or is authorized to use.

The API and static Command Center are separate Render services. After Google returns to the API callback, the API redirects the browser to the configured static frontend origin. Do not register the static frontend URL as the Google callback.

## 4. Configure Render secrets

Set all five values on the **API service**:

```text
GOOGLE_WORKSPACE_CLIENT_ID=<web OAuth client ID>
GOOGLE_WORKSPACE_CLIENT_SECRET=<web OAuth client secret>
GOOGLE_WORKSPACE_REDIRECT_URI=https://<COMMAND_CENTER_API_HOST>/api/google-workspace/oauth/callback
GOOGLE_WORKSPACE_APP_ORIGIN=https://<COMMAND_CENTER_WEB_HOST>
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY=<base64 32-byte key>
```

`GOOGLE_WORKSPACE_APP_ORIGIN` must contain only the static frontend origin: scheme, host, and optional port. Do not include a path, query string, fragment, or trailing slash. Example:

```text
https://adventure-zone-web.onrender.com
```

Generate the encryption key once and store it durably:

```bash
openssl rand -base64 32
```

Requirements:

- The decoded encryption key must be exactly 32 bytes.
- Never put the client secret, refresh token, or encryption key in GitHub, browser code, screenshots, support messages, or logs.
- Do not rotate the encryption key casually. Existing encrypted refresh credentials require the same key to be decrypted.
- All five variables must be either present together or absent together. Partial configuration is rejected without exposing secret values.
- Production redirect and app origins must use HTTPS.

## 5. Deploy and connect as the administrator

1. Deploy the API and frontend from the approved Phase 1 release.
2. Sign in as the Command Center administrator.
3. Open **Admin Tools → Google Workspace**.
4. Confirm the page describes the Email Review label/archive permission.
5. Select **Connect Google account**.
6. Sign in to the company Google account and review the requested scopes.
7. Grant the requested access only when the displayed app and API callback domain are correct.
8. Confirm Google returns you to the static Command Center—not the API service—and that the expected company email is displayed.

The application requests:

```text
openid
email
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
```

The Gmail modify scope permits the Command Center to read mail, create drafts, and perform the narrowly implemented Email Review label changes. Assignment applies one stable profile label to the whole thread and removes `INBOX`; Ignore performs no Gmail mutation. The app never removes `UNREAD`. Calendar and Drive remain read-only. The connection is rejected unless Google explicitly reports every required scope.

## 6. Preview the business-only scope

Select **Preview business scope**. The recommended Gmail roots must be:

```text
Shows
Receipts
Off Season Business Opportunities
Employees
Associations
```

Every saved Gmail label nested under one of those roots is included. Personal and unrelated labels remain excluded.

The four recommended Calendar sources must be:

```text
Adventure Zone Calendar
Pirates Rebellion Calendar
Warriors Playground Calendar
zone.pirate.warrior@gmail.com
```

The fourth source is selected by its Calendar ID even when its display name is different. A named Calendar must have one unambiguous exact match; the app will not silently choose the first of two same-named calendars.

The app will not save scope while an expected business root or Calendar is missing or ambiguous. First confirm whether it was renamed, removed, duplicated, or connected under the wrong Google account.

## 7. Save the exact IDs

After checking the preview:

1. Leave the approved business labels and calendars selected.
2. Select **Save business scope**.
3. Reload the page and confirm the saved labels and calendars remain visible.

The database stores Google label IDs and Calendar IDs as the authority. Display names are retained for people to read, but renaming a Google label later does not silently substitute a different source.

## 8. Verify the Phase 1 safety boundary

Before approving the release, confirm:

- No button exists to start historical backfill.
- No email body, attachment, Drive file, or Calendar event has been copied.
- Before the rollout flag is enabled, Gmail labels, read state, archive state, and messages are unchanged.
- After enablement, assigning a review item labels and archives only that entire thread; ignoring leaves Gmail unchanged.
- A later inbound message is processed at message level so it retains `INBOX` and `UNREAD` while receiving the profile label.
- Google Calendar events are unchanged.
- The Office Coordinator workspace has no Google connection settings.
- Leg-manager accounts have no Google connection settings.
- A missing, Office, or leg-manager bearer token receives an unauthorized response from owner Google settings endpoints.
- Disconnecting the account does not delete saved CRM data or Google data.
- Revoked Google credentials change the connection to **Reconnect required** without deleting the saved scope.

## 9. Troubleshooting

### `redirect_uri_mismatch`

Compare the Google OAuth client's authorized redirect URI with `GOOGLE_WORKSPACE_REDIRECT_URI` character for character. Confirm the request is reaching the API host, not the frontend host.

### Google returns to the API host or a 404 page

Verify `GOOGLE_WORKSPACE_APP_ORIGIN` is the static Command Center origin, such as `https://adventure-zone-web.onrender.com`. It must not be the API host and must not contain `/settings`, a query string, a fragment, or a trailing slash. Redeploy the API after correcting it, then start a new connection attempt.

### `GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE`

One or more of the five required Render values is missing or blank. Configure all five together.

### `GOOGLE_WORKSPACE_APP_ORIGIN_INVALID`

Set only an origin: `https://host.example.com` or `https://host.example.com:port`. Remove paths, query parameters, fragments, and credentials.

### `GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID`

Generate a new base64 value from exactly 32 random bytes. Do not replace a working production key after credentials have been stored unless a controlled credential rotation is being performed.

### `GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING`

The account did not explicitly grant every requested scope, including Gmail modify. Reconnect once after this release. Start the connection flow again through the administrator page and review the consent choices.

### `GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED`

Google rejected or revoked the stored refresh credential. Use **Reconnect Google account**. Saved label and Calendar selections remain in the Command Center.

### Expected label or Calendar is missing

Verify the connected account, then inspect the source in Gmail or Google Calendar. The Command Center intentionally does not fuzzy-match a similarly named personal label or Calendar. For a named Calendar, also check for two calendars with the same display name.


## 10. Enable profile-label synchronization

1. Deploy with `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=false`.
2. Reconnect the company Google account so the stored grant includes `gmail.modify`.
3. Confirm the existing Gmail hierarchy `Z - AdventureZone/Profiles` is present.
4. Enable `GOOGLE_WORKSPACE_GMAIL_PROFILE_LABEL_SYNC_ENABLED=true` and redeploy.
5. Assign one controlled Email Review thread. Confirm exactly one matching child label exists, the thread is no longer in Inbox, and unread state was not changed.
6. Send a new reply on that thread. Confirm the new message remains in Inbox and unread, and receives the same profile label.
7. Use Ignore on a controlled thread and confirm Gmail is unchanged.

If normalized duplicate child labels already exist, the app records a conflict and creates nothing. Resolve the duplicates manually; the rollout never auto-deletes Gmail labels.
