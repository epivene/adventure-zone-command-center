# Google Workspace Read-Only Setup

This procedure connects the Adventure Zone company Google account to the Command Center for the approved read-only Gmail, Calendar, and Drive work.

Phase 1 only establishes the secure connection and saves exact business-scope IDs. It does **not** import email bodies, attachments, Drive files, or Calendar events.

## 1. Keep production processing disabled

Deploy the foundation with these switches off:

```text
GOOGLE_WORKSPACE_SYNC_ENABLED=false
GOOGLE_WORKSPACE_AI_ENABLED=false
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

The value must match the deployed environment value exactly, including scheme, host, path, and trailing-slash behavior. Production must use HTTPS on a domain the business owns or is authorized to use.

## 4. Configure Render secrets

Set all four values on the API service:

```text
GOOGLE_WORKSPACE_CLIENT_ID=<web OAuth client ID>
GOOGLE_WORKSPACE_CLIENT_SECRET=<web OAuth client secret>
GOOGLE_WORKSPACE_REDIRECT_URI=https://<COMMAND_CENTER_API_HOST>/api/google-workspace/oauth/callback
GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY=<base64 32-byte key>
```

Generate the encryption key once and store it durably:

```bash
openssl rand -base64 32
```

Requirements:

- The decoded encryption key must be exactly 32 bytes.
- Never put the client secret, refresh token, or encryption key in GitHub, browser code, screenshots, support messages, or logs.
- Do not rotate the encryption key casually. Existing encrypted refresh credentials require the same key to be decrypted.
- All four variables must be either present together or absent together. Partial configuration is rejected.

## 5. Deploy and connect as the administrator

1. Deploy the API and frontend from the approved Phase 1 release.
2. Sign in as the Command Center administrator.
3. Open **Menu → Imports & Data → Google Workspace**.
4. Confirm the page says the connection is read-only.
5. Select **Connect Google account**.
6. Sign in to the company Google account and review the requested scopes.
7. Grant the requested access only when the displayed app and redirect domain are correct.
8. Return to the Command Center and confirm the expected company email is displayed.

The application requests:

```text
openid
email
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/drive.readonly
```

These scopes permit reading the required business data. They do not permit the Command Center to send mail, change Gmail labels, archive messages, or edit Calendar events. Google may require additional OAuth verification or security review before broader production use of sensitive or restricted scopes.

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

The fourth source is selected by its Calendar ID even when its display name is different.

Do not save the scope while the page reports a missing expected business root or Calendar. First confirm whether it was renamed, removed, or connected under the wrong Google account.

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
- Gmail labels, read state, archive state, and messages are unchanged.
- Google Calendar events are unchanged.
- The Office Coordinator workspace has no Google connection settings.
- Leg-manager accounts have no Google connection settings.
- A missing, Office, or leg-manager bearer token receives an unauthorized response from owner Google settings endpoints.
- Disconnecting the account does not delete saved CRM data or Google data.

## 9. Troubleshooting

### `redirect_uri_mismatch`

Compare the Google OAuth client's authorized redirect URI with `GOOGLE_WORKSPACE_REDIRECT_URI` character for character. Confirm the request is reaching the API host, not the frontend host.

### `GOOGLE_WORKSPACE_CONFIGURATION_INCOMPLETE`

One or more of the four required Render values is missing or blank. Configure all four together.

### `GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY_INVALID`

Generate a new base64 value from exactly 32 random bytes. Do not replace a working production key after credentials have been stored unless a controlled credential rotation is being performed.

### `GOOGLE_WORKSPACE_REQUIRED_SCOPES_MISSING`

The account did not grant every requested read-only scope. Start the connection flow again through the administrator page and review the consent choices.

### `GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED`

Google rejected or revoked the stored refresh credential. Use **Reconnect Google account**. Saved label and Calendar selections remain in the Command Center.

### Expected label or Calendar is missing

Verify the connected account, then inspect the source in Gmail or Google Calendar. The Command Center intentionally does not fuzzy-match a similarly named personal label or Calendar.
