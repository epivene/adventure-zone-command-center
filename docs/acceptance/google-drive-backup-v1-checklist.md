# Google Drive backup v1 acceptance checklist

- [ ] App changes enqueue transactionally and eventually export.
- [ ] Preview accounts for existing profiles, two rolling PDFs per profile, and source documents.
- [ ] Pilot contains no more than 25 profiles and reconciles planned versus exported/skipped/failed counts.
- [ ] Each profile folder contains only `Profile Summary.pdf` and `Follow-ups.pdf`.
- [ ] Source documents are under `Documents/<year>/<type>/<profile>/`.
- [ ] Unknown or untrustworthy years use `Documents/Needs Filing/`.
- [ ] Repeated exports preserve Drive file IDs and create no duplicate folders or files.
- [ ] Moving a document between year/type/profile updates the same Drive file ID.
- [ ] Exported email summaries include metadata, a short snippet, and app link—but no email body sentinel.
- [ ] App-side deletion/unlinking does not delete Drive files.
- [ ] Every created/reused parent validates back to the configured app-owned root.
- [ ] Amy's existing Drive tree receives zero writes.
- [ ] 401/403 and missing `drive.file` block safely and recover after reconnect.
- [ ] 429/5xx retries are paced and capped.
- [ ] Incremental priority 100 jobs remain ahead of backfill priority 10 jobs.
- [ ] Pause/resume and graceful shutdown preserve durable queue state.
- [ ] Full-backfill totals reconcile before completion is signed off.
- [ ] Runtime remains disabled by default until deployment, reconnect, preview, and pilot approval.
