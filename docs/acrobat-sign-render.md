# Acrobat Sign on Render

Adventure Zone can create, edit, review, and freeze contract drafts without Adobe credentials. Sending is disabled until the **Acrobat Sign API** is configured on Render.

An Acrobat Pro subscription by itself does not prove API access. The Adobe account must have Acrobat Sign API entitlement, an OAuth application, and permission to create agreements.

## Render environment secrets

Configure these only in the Render service environment. Never put their values in source control, browser code, logs, or chat:

- `ADOBE_SIGN_CLIENT_ID`
- `ADOBE_SIGN_CLIENT_SECRET`
- `ADOBE_SIGN_REFRESH_TOKEN`
- `ADOBE_SIGN_ACCOUNT_ID`
- `ADOBE_SIGN_DAVID_EMAIL`
- `ADOBE_SIGN_WEBHOOK_SECRET`

Optional:

- `ADOBE_SIGN_DAVID_NAME` (defaults to `David`)
- `ADOBE_SIGN_API_BASE_URL` (the account's regional Acrobat Sign v6 API base URL)
- `ADOBE_SIGN_TOKEN_URL` (defaults to Adobe IMS token v3)

The database remains selected by the existing `RENDER_DATABASE_URL` override. The tracked startup migration creates `contract_agreements` and the append-only `contract_provider_events` table in that Render database before the API serves normal traffic.

## Adobe OAuth application

Create an OAuth application in Adobe Developer Console for the Acrobat Sign product. Grant only the agreement scopes needed to create/read/cancel agreements and retrieve combined documents and audit trails. Obtain a refresh token using Adobe's authorization-code flow; the application never exposes it to the browser.

Use the application's deployed Render URL for OAuth callbacks. The current workflow consumes a pre-provisioned refresh token and does not expose an interactive OAuth callback to staff.

## Webhook

Register this HTTPS callback in Acrobat Sign:

`https://<render-api-host>/api/adobe/sign/webhook`

Subscribe to agreement status and participant signing events. Configure the same signing secret in Adobe and `ADOBE_SIGN_WEBHOOK_SECRET`.

Callbacks are authenticated, deduplicated by provider event ID, appended to provider event history, and then mapped to CRM state. Browser actions never mark a contract signed. Completed PDFs and audit trails are downloaded from Adobe and stored in private object storage.

## Readiness

Authenticated staff can query:

`GET /api/office/contracts/readiness`

The response contains only readiness and missing variable names. It never returns secret values. `signApiAvailable: true` means configuration is present; Adobe entitlement and token validity are confirmed by the first authenticated provider request.