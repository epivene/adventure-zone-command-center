# Act! Contact Sync Operations

The Command Center synchronizes contacts with Act! Premium Cloud only when the
owner presses a button. It never schedules a background sync. **Sync with
Act!** reads both systems and stores a preview; only the separate **Apply approved**
action writes selected changes.

## Render configuration

Open the existing Render web service, select **Environment**, and add these
values directly there:

| Name | Value |
| --- | --- |
| `ACT_API_BASE_URL` | `https://apius.act.com/act.web.api` |
| `ACT_DATABASE_NAME` | The Act! database name shown in About Act! |
| `ACT_USERNAME` | The shared Act! login name |
| `ACT_PASSWORD` | The shared Act! password |

Save the values as Render environment secrets. Do not paste the username or
password into chat, GitHub, source files, screenshots, shell history, or
support tickets. Do not prefix any of these names with `NEXT_PUBLIC_`.

After saving, let Render redeploy. Open **Settings → Act! Sync**. The page may
show a masked database suffix, but it must never show the username, password,
Basic header, or bearer token.

## First connection and preview

1. Press **Test connection**. This authenticates and reports only a sanitized
   success or error. It does not read or change contacts.
2. Press **Sync with Act!**. Wait for the preview and review every category,
   including zero-count categories.
3. Open one category and press **Approve only [category] ([count])**. This
   clears hidden selections and approves only the category being viewed.
4. Press **Apply [count] approved**. The app imports in batches of 50 and shows
   progress in the sticky action bar.
5. If individual contacts fail, let the remaining batches finish, review the
   failed rows, and press **Retry failed contacts**. If the connection is
   interrupted, press **Retry remaining contacts** after connectivity returns.
6. Resolve Changed in both and Possible matches one row at a time. These
   categories never have a bulk-approval action.
7. Verify a small sample in Contacts before moving to another category.

Importing **New in Act!** creates Command Center contacts only and never writes
to the shared Act! account. Do not approve **New in app** unless those contacts
are intentionally meant to be created in Act!.

The sync does not delete missing contacts. A linked contact that is absent
from Act! is reported for review.

## Error meanings

- HTTP **401** means Act! rejected authentication. Re-enter the shared
  username/password in Render, redeploy, and use Test connection.
- Act! error **4032** means the account or subscription lacks the required Web
  API permission. Stop and ask the Act! administrator or support to enable it.
- HTTP **429** means Act! rate-limited the request. Do not repeatedly click the
  button. Wait for the indicated reset period, then create a fresh preview.
- “Act! changed after this preview” means the saved review is stale. Create a
  new preview instead of forcing the old row.

Application logs must contain sanitized messages only. If a credential or
token ever appears in a log, rotate the password immediately and restrict or
remove the affected log.

## Interrupted or partial apply

Each row is claimed and recorded separately. Completed and skipped rows are
idempotent and will not run again. Failed rows retain a sanitized result and
may be retried with the same preview if the underlying record has not changed.

After an interruption:

1. Do not create duplicate contacts manually.
2. Reopen the same preview URL and apply only the failed decisions.
3. If Act! changed or the preview is stale, create a fresh preview.
4. Verify completed rows in both systems before continuing.

## Shared-password rotation

When the shared Act! password changes:

1. Change it in Act! through the approved account process.
2. Immediately replace only `ACT_PASSWORD` in Render; never send it through
   chat or email.
3. Redeploy the service.
4. Press **Test connection**.
5. Inspect Render logs for sanitized success/failure messages and no secrets.

If rotation fails, leave contact sync unused and use the CSV fallback until
the credentials are repaired.

## XLS/CSV fallback

If the Web API is unavailable, export **All contacts** from Act! as XLS. You do
not need Microsoft Excel: open the XLS in Google Sheets or LibreOffice and
download it as CSV without changing identifiers or leading zeroes. Then use
**Settings → Import fallback** and follow
[act-import.md](./act-import.md). The fallback imports into the Command Center
only and never writes to Act!.
