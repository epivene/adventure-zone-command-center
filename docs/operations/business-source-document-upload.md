# Business source document upload and linking

Use the owner **Settings → Business sources** page for protected event-source files. Do not add signed contracts or vendor applications to GitHub.

## Ravalli County Fair — 2025 contract

Source file: `pirates rebellion contract.pdf`

1. Open **Settings → Business sources** and find **Ravalli County Fair Pirate's Rebellion Contract**.
2. Under **File, links & historical terms**, upload `pirates rebellion contract.pdf`.
3. Search profiles and select the existing **Ravalli County Fair** profile in Hamilton, Montana. If there are multiple possible profiles, confirm the correct location before linking.
4. Add the profile link. Link the historical terms to that reviewed link before approving them.
5. Review each proposed historical term. The negotiated `630000` cents ($6,300) is a **2025 event-specific contract rate**, not a current package price.
6. Verify **Packages & resources** still shows the current reviewed package defaults. The contract must not change Adventure Zone, Pirate's Rebellion, Warrior's Playground, or Mini Zone base pricing.
7. Do not copy signatures or private legal identifiers into ordinary profile notes or historical terms.

## Hawthorne Armed Forces Day — 2026 vendor application

Source file: `VENDOR APP 2026.docx`

1. Open **Settings → Business sources** and find **Hawthorne Armed Forces Day Vendor Application**.
2. Upload `VENDOR APP 2026.docx`.
3. Search profiles and select the existing **75th Annual Armed Forces Day / Hawthorne Armed Forces Day** profile in Hawthorne, Nevada. Confirm the location before linking.
4. Add the profile link. Link the historical terms to that reviewed link before approving them.
5. Keep the `2026-04-25` application deadline as historical information only. **Do not create an overdue task or follow-up.**
6. Keep the 10x10, 10x25, and 15x20 booth sizes marked as vendor-form context only. They are **not Adventure Zone package footprint approvals**.
7. Confirm no package/resource space requirement was changed from the vendor form.

## Replacing a mistaken file

1. Open the same Business source row.
2. Use **Upload or replace file** and choose the corrected file.
3. The new protected object is uploaded first and its metadata is saved before the old object is cleaned up.
4. Re-open the document to confirm the correct file is attached.

## Fixing a wrong profile link

1. In **Linked to**, select **Unlink** on the wrong target.
2. Search for the correct active profile and add the new link.
3. Historical terms already approved to another link are evidence records; do not silently reinterpret them. Review/correct the term association explicitly before relying on them.

## Verification checklist

After uploading/linking either file:

- The source card says **Uploaded** / **file stored**.
- The owner profile shows the document only after it is linked.
- Only approved historical terms appear on the profile.
- Office Coordinator does not see these two owner-only documents in release 1.
- Leg Manager does not receive these sales/legal documents.
- No persistent storage key is visible in the browser UI/API payloads.
- Ravalli's $6,300 negotiated rate did not change package defaults.
- Hawthorne's passed April 25, 2026 deadline did not create a task/follow-up.

## Private-file Git check

Before merging, verify that the actual private business binaries are not tracked:

```bash
git ls-files | rg -i "pirates rebellion contract|vendor app 2026|\\.pdf$|\\.docx$" || true
```

The uploaded private contract/application must not appear as tracked files. Documentation PDFs/DOCX files should also be reviewed intentionally if this command returns anything else.
