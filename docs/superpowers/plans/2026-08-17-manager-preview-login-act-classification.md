# Manager preview, login, and ACT classification hotfix

Scope:
- keep a newly successful manager login from being cleared by a stale saved-token bootstrap request
- show the manager-preview scheduled event list even when an event has no map coordinates yet
- classify blank/link/update bookkeeping as System rather than Notes while preserving human prose/email notes

No database schema or permission changes.
