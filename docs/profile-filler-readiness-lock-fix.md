# Profile filler readiness lock fix

The October 16 startup log fails with PostgreSQL 55P03 inside
isProfileFillerSchemaReady before the migration is attempted. The former
readiness query resolves the live relation and deparses expressions against it;
these operations can acquire relation locks and wait behind another transaction.

The new probe reads organizations metadata directly from PostgreSQL catalogs.
It compares stored expression trees with a uniquely named temporary reference
table parsed by the same database server. Only source positions and column
numbers are normalized; operator/function/type identifiers, constants, defaults,
nullability, validation, enforcement and inheritance semantics are checked.
This preserves exact constraint validation without deparsing the live table or
hardcoding one PostgreSQL version's expression format.

The reference table is dropped on success. On failure the existing startup
wrapper rolls back or destroys the connection; cleanup SQL is not queued behind
a read timeout. No production table or record is dropped. The existing timeout,
repair, advisory-lock and fail-closed behavior stays in place. If the schema
actually needs repair and another session blocks DDL, startup will still fail
safely. This does not terminate database sessions or bypass real lock blockers.

Seventeen tests pass, including real PGlite schema creation/repair, malformed
constraints, default/nullability drift, reordered/dropped columns, temp cleanup,
and pg_locks verification of no live organizations relation lock. Wrapper tests
cover lock contention, commit/repair failure and read-timeout connection disposal.
No full app build or production deployment was performed. Direct production
database diagnostics were unavailable; the identity of the blocking session is
not established. The database role must retain TEMP privilege for this check.

After deployment verify that required profile filler schema completes and the
API health endpoint becomes ready. Then resume the three authorized work-card
handoffs; this code change does not modify those cards.
