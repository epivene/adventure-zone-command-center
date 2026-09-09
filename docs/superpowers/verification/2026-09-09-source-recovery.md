# Early Bird source recovery

Main at e305465bd0c63e04db94c8dfb66f0d19125dd817 contains 25 files replaced by empty contents or a base64 decoder error in PR #782. This prevents package parsing, startup, and use of the affected email/profile screens.

Recovery uses the last valid main contents at 9555598c84ec7f681d8dd7a91583bd129cfac21f plus the intended PR #779 changes. The actual common ancestor is abb2b6a9407e26203c5e7ac89b6d455f80791ff1. Its branch was older than the advertised target base; using that target as the merge ancestor would discard newer features. Four merge conflicts were resolved by retaining both the current integrations and the Early Bird additions.

Preserved integrations include Boss and office permissions, Gmail thread locking, current background workers, startup prerequisites, newer database migrations and exports. Recovery does not send emails or import customer records.

Verification in a local checkout with current server, web, and database sources:

- Database TypeScript build passed.
- API production build passed.
- Web production build passed.
- Focused API checks: 66 tests across 14 files passed.
- Early Bird card and office review screen: 9 tests across 2 files passed.
- Added 25 source-integrity cases checking nonempty source, TypeScript parsing, and the database package export.

An additional existing test, google-profile-email-archive-repository.test.ts, cannot load because google-profile-email-archive-repository.ts is absent from main. That separate unfinished implementation is outside this source recovery. This is not a claim that the full repository test suite passes.

Only the 25 recovered files, the integrity test, and this verification note belong in the repair PR. The convention feature remains separate.
