# Early Bird integration reapplication

Reapplied the intact original integration patch onto restored main commit
`73f601b98db75ffe095cc79f5355f105d37d8b18`. Resolved the startup and schema
export conflicts by retaining both the newer functionality and the promo additions.
The existing template body_format startup repair remains in place.

Validation on Node 24.19.0 (Render uses Node 22):

- Database TypeScript build passed.
- API production build passed.
- Web production build passed.
- Focused API tests: 14 files, 50 tests passed, including PGlite lifecycle,
  schema, offer seed, confirmed-send coordination, reminder worker, routes,
  startup order, and the body_format startup repair.
- Focused web tests: 2 files, 9 tests passed (promo card and office review).
- Git whitespace check passed.

The first API test run lacked DATABASE_URL and could not import the existing
startup test. Rerunning with an inert localhost test URL passed. Database lifecycle
tests use PGlite; no production database was contacted and no email was sent.

This verifies the focused integration and production bundles, not the entire
repository test suite or a live Render deployment.
