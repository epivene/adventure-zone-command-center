# Website Inquiry Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Host the Adventure Zone Wix custom-element script on the existing Render static site and send its contact form into a secure, permission-controlled Command Center review inbox that can deliberately convert an inquiry into CRM records.

**Architecture:** The Render static frontend serves one dependency-free custom-element file. That file posts a strict, idempotent JSON contract to one anonymous API endpoint. PostgreSQL keeps inquiries separate from CRM records; a durable worker sends notification email, and authenticated owner/authorized Office users use a shared inbox UI for review, match suggestions, and one-transaction conversion.

**Tech Stack:** TypeScript, Express 5, Zod, Drizzle ORM/PostgreSQL, Vitest, Supertest, PGlite, React 19, TanStack Query, Wouter, Vite, Wix custom elements, Render.

**Spec:** docs/superpowers/specs/2026-09-03-website-inquiry-inbox-design.md

## Global Constraints

- Work from the command-center repository on branch feature/website-inquiry-inbox.
- Use pnpm only. Do not add a second package manager or a second web service.
- Follow red-green-refactor: add one focused failing test, run it and record the expected failure, implement the smallest production change, then rerun.
- The anonymous endpoint may create only website inquiry records. It must never create or mutate contacts, organizations, bookings, activities, or follow-ups.
- Never put SMTP credentials, session secrets, database URLs, recipient addresses, or rate-limit secrets in adventure-zone-site.js.
- Never store a raw visitor IP. The rate limiter may hold only an HMAC digest in process memory.
- Owner access follows the existing owner/admin bearer-token boundary. Office access requires an enabled session and canReviewWebsiteInquiries === true.
- All reviewer state changes and conversion are server-authorized and audited. Hiding a link in React is not authorization.
- Production origins are exactly https://the-adventure-zone.com and https://www.the-adventure-zone.com. Localhost origins are accepted only when NODE_ENV is not production.
- Do not push, deploy, edit Wix, delete the diagnostic custom element, publish Wix, stop Replit, or send a production test inquiry until the explicit gates in Task 12 are approved.

---

## Task 1: Add the inquiry table, alert lease fields, and Office permission

**Files:**

- Create: lib/db/src/website-inquiry-schema.ts
- Create: lib/db/src/website-inquiry-schema.test.ts
- Create: lib/db/migrations/20260903_website_inquiry_inbox.sql
- Modify: lib/db/src/office-coordinator-schema.ts
- Modify: lib/db/src/index.ts
- Modify: lib/db/src/migrations.ts
- Modify: lib/db/package.json
- Modify: artifacts/api-server/src/db/schema.ts

- [x] **Step 1: Write the failing schema contract test**

Create lib/db/src/website-inquiry-schema.test.ts. Use drizzle-orm getTableName and drizzle-orm/pg-core getTableConfig to assert:

~~~ts
expect(getTableName(websiteInquiries)).toBe("website_inquiries");
expect(websiteInquiryStatusValues).toEqual([
  "new", "reviewing", "converted", "archived", "spam",
]);
expect(websiteInquiryAlertStateValues).toEqual([
  "pending", "sending", "retry", "sent", "failed",
]);
expect(config.indexes.map((index) => index.config.name)).toEqual(
  expect.arrayContaining([
    "website_inquiries_status_created_idx",
    "website_inquiries_normalized_email_idx",
    "website_inquiries_fingerprint_created_idx",
    "website_inquiries_alert_due_idx",
  ]),
);
expect(officeAccounts.canReviewWebsiteInquiries.name)
  .toBe("can_review_website_inquiries");
~~~

- [x] **Step 2: Run the test and confirm the red state**

Run:

    pnpm exec vitest run lib/db/src/website-inquiry-schema.test.ts

Expected: FAIL because website-inquiry-schema.ts and canReviewWebsiteInquiries do not exist.

- [x] **Step 3: Define the Drizzle schema**

Create websiteInquiryStatusValues and websiteInquiryAlertStateValues as the exact arrays above. Define websiteInquiries with these columns:

~~~ts
id: uuid("id").defaultRandom().primaryKey()
submissionId: uuid("submission_id").notNull()
referenceCode: text("reference_code").notNull()
status: text("status").$type<WebsiteInquiryStatus>().default("new").notNull()
name: text("name").notNull()
email: text("email").notNull()
normalizedEmail: text("normalized_email").notNull()
eventName: text("event_name").notNull()
eventDate: date("event_date")
eventLocation: text("event_location")
packageInterest: text("package_interest")
message: text("message").notNull()
pageUrl: text("page_url").notNull()
sourceOrigin: text("source_origin").notNull()
contentFingerprint: text("content_fingerprint").notNull()
reviewedByKind: text("reviewed_by_kind")
reviewedById: text("reviewed_by_id")
reviewedByName: text("reviewed_by_name")
reviewedAt: timestamp("reviewed_at", { withTimezone: true })
convertedContactId: uuid("converted_contact_id").references(() => contacts.id, { onDelete: "set null" })
convertedOrganizationId: uuid("converted_organization_id").references(() => organizations.id, { onDelete: "set null" })
convertedBookingId: uuid("converted_booking_id").references(() => bookings.id, { onDelete: "set null" })
convertedAt: timestamp("converted_at", { withTimezone: true })
alertState: text("alert_state").$type<WebsiteInquiryAlertState>().default("pending").notNull()
alertAttemptCount: integer("alert_attempt_count").default(0).notNull()
alertNextAttemptAt: timestamp("alert_next_attempt_at", { withTimezone: true }).defaultNow().notNull()
alertLastAttemptAt: timestamp("alert_last_attempt_at", { withTimezone: true })
alertFailureReason: text("alert_failure_reason")
alertDeliveredRecipients: jsonb("alert_delivered_recipients").$type<string[]>().default(sql`'[]'::jsonb`).notNull()
alertLeaseOwner: text("alert_lease_owner")
alertLeaseExpiresAt: timestamp("alert_lease_expires_at", { withTimezone: true })
createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
~~~

Add unique indexes for submissionId and referenceCode, checks for both enums, a nullable owner/office reviewer kind, converted-status identifier consistency, and nonnegative alert attempts, plus the four indexes asserted by the test. Add canReviewWebsiteInquiries: boolean("can_review_website_inquiries").default(false).notNull() to officeAccounts.

- [x] **Step 4: Add the idempotent SQL migration**

Create 20260903_website_inquiry_inbox.sql with CREATE TABLE IF NOT EXISTS, ALTER TABLE office_accounts ADD COLUMN IF NOT EXISTS, named checks, foreign keys, and CREATE INDEX IF NOT EXISTS matching the Drizzle declaration. Use a DO block for constraints that PostgreSQL cannot add conditionally. Do not drop or rewrite existing data.

Append this migration to migrationFiles in lib/db/src/migrations.ts with a marker that requires both the table and Office permission:

~~~sql
SELECT
  to_regclass(current_schema() || '.website_inquiries') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'office_accounts'
      AND column_name = 'can_review_website_inquiries'
  ) AS ready
~~~

- [x] **Step 5: Export and register the schema**

Import the new module into the schema object in lib/db/src/index.ts, export it from that file and artifacts/api-server/src/db/schema.ts, and add:

    "./website-inquiry-schema": "./src/website-inquiry-schema.ts"

to lib/db/package.json exports.

- [x] **Step 6: Run focused and package verification**

Run:

    pnpm exec vitest run lib/db/src/website-inquiry-schema.test.ts
    pnpm --filter @workspace/db build

Expected: PASS.

- [x] **Step 7: Commit**

    git add lib/db artifacts/api-server/src/db/schema.ts
    git commit -m "feat: add website inquiry persistence schema"

---

## Task 2: Gate startup on the required database shape

**Files:**

- Create: artifacts/api-server/src/db/website-inquiry-startup-migration.ts
- Create: artifacts/api-server/src/db/website-inquiry-required-startup.ts
- Create: artifacts/api-server/src/db/website-inquiry-required-startup.test.ts
- Modify: artifacts/api-server/src/db/required-schema-startup.ts
- Modify: artifacts/api-server/src/db/required-schema-startup.test.ts

- [ ] **Step 1: Write the failing lock-and-registration tests**

Copy the dependency-injected structure used by office-coordinator-required-startup.test.ts. Assert that:

- the advisory lock key is adventure-zone:website-inquiry-schema;
- ensureWebsiteInquirySchema runs only while the lock is held;
- the client is unlocked and released on success and failure;
- runRequiredSchemaStartup invokes a step named required website inquiry schema.

- [ ] **Step 2: Run the tests and confirm the red state**

    pnpm --filter @workspace/api-server test -- src/db/website-inquiry-required-startup.test.ts src/db/required-schema-startup.test.ts

Expected: FAIL because the new startup modules and dependency are absent.

- [ ] **Step 3: Implement the idempotent startup migration**

In website-inquiry-startup-migration.ts, export:

~~~ts
export async function ensureWebsiteInquirySchema(
  client: { query(sql: string): Promise<unknown> },
): Promise<boolean>
~~~

Execute the same additive SQL as the migration. Return true after a final marker query confirms both required objects. Never catch and suppress DDL errors.

In website-inquiry-required-startup.ts, follow the existing office coordinator lock wrapper exactly, using pg_try_advisory_lock and a finally block that unlocks and releases.

- [ ] **Step 4: Register the required startup step**

Add ensureWebsiteInquiries?: RequiredStep to the dependency type and invoke it immediately after the Office Coordinator schema step. This ordering ensures office_accounts exists before its permission column is checked.

- [ ] **Step 5: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/db/website-inquiry-required-startup.test.ts src/db/required-schema-startup.test.ts
    pnpm --filter @workspace/api-server typecheck
    git add artifacts/api-server/src/db
    git commit -m "feat: require website inquiry schema at startup"

Expected: tests and typecheck PASS.

---

## Task 3: Carry the dedicated Office permission through authentication and administration

**Files:**

- Modify: artifacts/api-server/src/features/office/office-account-repository.ts
- Modify: artifacts/api-server/src/features/office/office-middleware.ts
- Modify: artifacts/api-server/src/features/office/office-auth.test.ts
- Modify: artifacts/api-server/src/routes/office-auth.ts
- Modify: artifacts/api-server/src/routes/office-auth.test.ts
- Modify: artifacts/api-server/src/routes/office-admin-accounts.ts
- Modify: artifacts/api-server/src/routes/office-admin-accounts.test.ts

- [ ] **Step 1: Add failing permission propagation tests**

Extend the account fixture with canReviewWebsiteInquiries: false. Add tests proving:

~~~ts
expect(session).toMatchObject({
  accountId: account.id,
  canReviewWebsiteInquiries: true,
});
expect(response.body.office.canReviewWebsiteInquiries).toBe(true);
expect(mocks.updateAccount).toHaveBeenCalledWith(account.id, {
  canReviewWebsiteInquiries: true,
});
~~~

Also keep the unknown role field rejection test.

- [ ] **Step 2: Run and observe failure**

    pnpm --filter @workspace/api-server test -- src/features/office/office-auth.test.ts src/routes/office-auth.test.ts src/routes/office-admin-accounts.test.ts

Expected: FAIL because repository/session/route types omit the permission.

- [ ] **Step 3: Thread the boolean through repository records**

Add canReviewWebsiteInquiries: boolean to credential/session records, every select and returning map, createAccount input with default false, and updateAccount input. When permission changes, increment sessionVersion so an already-issued token immediately reloads authority.

- [ ] **Step 4: Thread the permission through auth**

Add the boolean to OfficeSessionRepository, OfficeRequestContext, resolveOfficeSession, login, demo-login, and /office/auth/me responses. Keep the token claims unchanged; authority comes from the current database row, not a stale token claim.

- [ ] **Step 5: Add the owner administration field**

Allow canReviewWebsiteInquiries in createSchema and patchSchema. New accounts default false unless the owner explicitly checks the field. This is the only path used later to grant Amy access; do not match on the name Amy in production code.

- [ ] **Step 6: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/features/office/office-auth.test.ts src/routes/office-auth.test.ts src/routes/office-admin-accounts.test.ts
    pnpm --filter @workspace/api-server typecheck
    git add artifacts/api-server/src/features/office artifacts/api-server/src/routes/office-auth* artifacts/api-server/src/routes/office-admin-accounts*
    git commit -m "feat: add Office website inquiry permission"

---

## Task 4: Implement strict origin, payload, honeypot, and rate-limit controls

**Files:**

- Create: artifacts/api-server/src/features/website-inquiries/public-contract.ts
- Create: artifacts/api-server/src/features/website-inquiries/public-contract.test.ts
- Create: artifacts/api-server/src/features/website-inquiries/public-security.ts
- Create: artifacts/api-server/src/features/website-inquiries/public-security.test.ts

- [ ] **Step 1: Write failing contract tests**

Define validInput once and cover:

- required name, email, eventName, message, submissionId, website, and pageUrl;
- optional eventDate, eventLocation, and packageInterest;
- strict rejection of unknown fields;
- RFC-style email parsing through Zod email();
- YYYY-MM-DD date validation;
- maximum lengths: name 160, email 320, eventName 240, eventLocation 300, packageInterest 160, message 5000, pageUrl 2048;
- honeypot must equal the empty string.

The public DTO is:

~~~ts
type WebsiteInquirySubmission = {
  submissionId: string;
  name: string;
  email: string;
  eventName: string;
  eventDate?: string;
  eventLocation?: string;
  packageInterest?: string;
  message: string;
  website: "";
  pageUrl: string;
};
~~~

- [ ] **Step 2: Write failing security tests**

Test readAllowedOrigins and FixedWindowInquiryRateLimiter:

- production accepts only the two configured production origins;
- production rejects missing settings and every localhost origin;
- test/development may add http://localhost:5173 and http://127.0.0.1:5173;
- pageUrl origin must equal the request Origin;
- six requests from one key inside 15 minutes make the sixth fail;
- another key remains allowed;
- the in-memory map key is a 43-character base64url HMAC digest and never contains the raw IP.

- [ ] **Step 3: Run and confirm red**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/public-contract.test.ts src/features/website-inquiries/public-security.test.ts

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the contract and security primitives**

Export:

~~~ts
export const websiteInquirySubmissionSchema: z.ZodType<WebsiteInquirySubmission>
export function readWebsiteInquiryAllowedOrigins(
  env: NodeJS.ProcessEnv,
  nodeEnv: string | undefined,
): ReadonlySet<string>
export function assertAllowedInquiryPage(
  headerOrigin: string | undefined,
  pageUrl: string,
  allowed: ReadonlySet<string>,
): { origin: string }
export class FixedWindowInquiryRateLimiter {
  constructor(options: { limit: number; windowMs: number; secret: string; now?: () => number })
  consume(rawClientAddress: string): { allowed: boolean; retryAfterSeconds: number }
}
~~~

Use createHmac("sha256", secret), prune expired windows on consume, and expose no method that returns raw keys.

- [ ] **Step 5: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/public-contract.test.ts src/features/website-inquiries/public-security.test.ts
    git add artifacts/api-server/src/features/website-inquiries
    git commit -m "feat: validate and protect public website inquiries"

---

## Task 5: Persist public submissions idempotently without touching CRM data

**Files:**

- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-repository.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-service.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-service.test.ts
- Create: artifacts/api-server/src/routes/public-website-inquiries.ts
- Create: artifacts/api-server/src/routes/public-website-inquiries.test.ts
- Modify: artifacts/api-server/src/app.ts
- Modify: artifacts/api-server/src/routes/index.ts
- Modify: artifacts/api-server/src/routes/routes-index-imports.test.ts

- [ ] **Step 1: Write failing service tests**

Use an in-memory fake implementing:

~~~ts
export interface WebsiteInquiryIntakeRepository {
  findBySubmissionId(submissionId: string): Promise<WebsiteInquiryReceipt | null>;
  findRecentByFingerprint(input: {
    normalizedEmail: string;
    contentFingerprint: string;
    since: Date;
  }): Promise<WebsiteInquiryReceipt | null>;
  create(input: NewWebsiteInquiry): Promise<WebsiteInquiryReceipt>;
}
~~~

Assert that createInquiry:

- lowercases and trims email;
- fingerprints canonical normalized fields with SHA-256;
- generates AZI-YYYY-XXXXXXXX referenceCode;
- uses a 15-minute recent-content duplicate window;
- returns the existing receipt for the same submissionId;
- returns the recent receipt for same content with a new submissionId;
- calls create exactly once;
- never receives a CRM repository dependency.

- [ ] **Step 2: Run service tests and confirm red**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-service.test.ts

Expected: FAIL because repository and service are absent.

- [ ] **Step 3: Implement repository and service**

The service result is:

~~~ts
type WebsiteInquiryReceipt = {
  inquiryId: string;
  referenceCode: string;
  createdAt: Date;
};
type CreateInquiryResult = WebsiteInquiryReceipt & {
  duplicate: boolean;
};
~~~

Handle PostgreSQL unique violation 23505 by re-reading submissionId, so concurrent retry requests return one success. If the collision is only the generated reference code, generate another code and retry at most three times. Log only inquiryId/referenceCode/error category; never log the full request body or message.

- [ ] **Step 4: Write failing route security and response tests**

With Supertest, assert:

- valid allowed-origin POST returns 201 and a visitor-safe message;
- idempotent duplicate returns 200 with the same reference;
- disallowed/missing Origin returns 403;
- pageUrl/origin mismatch returns 403;
- honeypot or unknown field returns 400;
- rate limit returns 429 plus Retry-After;
- an oversized body returns JSON 413;
- a repository exception returns generic JSON 503;
- no owner token is required for only this route.

- [ ] **Step 5: Add path-specific parsing and CORS**

Before the global 1mb JSON parser in app.ts, mount:

~~~ts
app.use(
  "/api/public/website-inquiries",
  createWebsiteInquiryCorsMiddleware(process.env),
  express.json({ limit: "16kb", strict: true }),
  websiteInquiryBodyErrorHandler,
);
~~~

Mount publicWebsiteInquiriesRouter in routes/index.ts before requireOwnerMiddleware. The route obtains req.ip, runs the HMAC limiter, validates Origin and pageUrl, parses Zod, and calls the service. Configure app.set("trust proxy", 1) so req.ip reflects Render's first trusted proxy hop.

- [ ] **Step 6: Run route and regression tests**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-service.test.ts src/routes/public-website-inquiries.test.ts src/routes/routes-index-imports.test.ts
    pnpm --filter @workspace/api-server typecheck

Expected: PASS. Confirm the existing owner and Office route mounts are unchanged.

- [ ] **Step 7: Commit**

    git add artifacts/api-server/src/app.ts artifacts/api-server/src/routes artifacts/api-server/src/features/website-inquiries
    git commit -m "feat: accept website inquiries into a review queue"

---

## Task 6: Deliver durable email alerts with bounded retry

**Files:**

- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-alert-worker.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-alert-worker.test.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-alert-worker-loop.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-alert-worker-loop.test.ts
- Modify: artifacts/api-server/src/features/website-inquiries/website-inquiry-repository.ts
- Modify: artifacts/api-server/src/features/website-inquiries/website-inquiry-service.test.ts
- Modify: artifacts/api-server/src/index.ts

- [ ] **Step 1: Write failing alert worker tests**

Use a fake repository and MailDelivery. Cover:

- pending inquiry sends one concise email per unsent configured recipient;
- subject includes reference and event name;
- body includes name, email, date/location summary, and a secure Command Center deep link, but not the full message;
- successful recipients are persisted in alertDeliveredRecipients;
- all recipients delivered marks sent;
- SMTP failure stores only a 300-character sanitized reason and schedules 1m, 5m, 30m, 2h, then 8h delays;
- attempt six marks failed and does not retry;
- missing recipient configuration marks failed without affecting the saved inquiry;
- an active lease prevents a second worker from claiming the same alert.

- [ ] **Step 2: Run and confirm red**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-alert-worker.test.ts src/features/website-inquiries/website-inquiry-alert-worker-loop.test.ts

Expected: FAIL because worker modules do not exist.

- [ ] **Step 3: Implement repository leasing**

Add claimNextAlert, recordRecipientDelivered, completeAlert, and failAlert. claimNextAlert must use one transaction, FOR UPDATE SKIP LOCKED, and a five-minute lease. Due states are pending and retry; expired sending leases are reclaimable.

- [ ] **Step 4: Implement worker and loop**

Parse WEBSITE_INQUIRY_ALERT_RECIPIENTS as trimmed, case-insensitively deduplicated comma-separated email addresses. Use createMailDeliveryFromEnv from features/office/mail-delivery.ts. Read the deep-link base from WEBSITE_INQUIRY_INBOX_BASE_URL. Include both authenticated paths so either authorized workspace can open the same record:

    /website-inquiries?inquiry={id}
    /office/website-inquiries?inquiry={id}

Follow scout-alert-worker-loop.ts lifecycle:

~~~ts
worker.runOne({ workerId, now }): Promise<{ kind: "idle" | "progress" }>
loop.start(): void
loop.close(): Promise<void>
~~~

Schedule immediate work after progress, 30 seconds after idle, and 60 seconds after an unexpected worker error.

- [ ] **Step 5: Register lifecycle**

Instantiate the loop in index.ts, start it in startBackgroundWorkers, and close it in the shutdown Promise.all. Worker startup failure must be logged without preventing the API from serving already-saved inquiries.

- [ ] **Step 6: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-alert-worker.test.ts src/features/website-inquiries/website-inquiry-alert-worker-loop.test.ts src/features/website-inquiries/website-inquiry-service.test.ts
    pnpm --filter @workspace/api-server typecheck
    git add artifacts/api-server/src/features/website-inquiries artifacts/api-server/src/index.ts
    git commit -m "feat: send durable website inquiry alerts"

---

## Task 7: Add dual-auth inbox, count, detail, and review actions

**Files:**

- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-authorization.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-authorization.test.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-review-service.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-review-service.test.ts
- Create: artifacts/api-server/src/routes/website-inquiries.ts
- Create: artifacts/api-server/src/routes/website-inquiries.test.ts
- Modify: artifacts/api-server/src/features/website-inquiries/website-inquiry-repository.ts
- Modify: artifacts/api-server/src/routes/index.ts

- [ ] **Step 1: Write failing authorization tests**

Define:

~~~ts
type WebsiteInquiryActor =
  | { kind: "owner"; id: "owner"; name: "Owner" }
  | { kind: "office"; id: string; name: string };
~~~

Assert owner token succeeds; enabled Office token with permission succeeds; Office without permission gets 403; disabled/expired/invalid/no token gets 401; manager tokens do not gain access.

- [ ] **Step 2: Write failing review-service tests**

Cover newest-first list pagination, status filter, count of only new, detail with audit history, and transition rules:

~~~ts
new -> reviewing
new | reviewing -> archived
new | reviewing -> spam
archived | spam -> new
converted -> no status mutation
~~~

Each successful action calls recordAuditEntry with entityType website_inquiry, the inquiry UUID, the action name, before/after status, and actor kind/id/name inside the after snapshot.

- [ ] **Step 3: Run and confirm red**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-authorization.test.ts src/features/website-inquiries/website-inquiry-review-service.test.ts src/routes/website-inquiries.test.ts

Expected: FAIL because authorization, service, and routes are absent.

- [ ] **Step 4: Implement dual authorization**

Try verifyToken first. Otherwise resolve the Office session through DrizzleOfficeAccountRepository. Set req.websiteInquiryActor only after checking canReviewWebsiteInquiries. Extend the Express Request declaration in the authorization module.

- [ ] **Step 5: Implement routes**

Mount before requireOwnerMiddleware:

~~~text
GET   /website-inquiries/count
GET   /website-inquiries?status=new&cursor=<createdAt,id>&limit=25
GET   /website-inquiries/:inquiryId
PATCH /website-inquiries/:inquiryId/status
~~~

The PATCH body is strict { action: "begin_review" | "archive" | "spam" | "restore" }. Return 409 for invalid transitions and 404 for unknown IDs.

- [ ] **Step 6: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-authorization.test.ts src/features/website-inquiries/website-inquiry-review-service.test.ts src/routes/website-inquiries.test.ts
    pnpm --filter @workspace/api-server typecheck
    git add artifacts/api-server/src/features/website-inquiries artifacts/api-server/src/routes
    git commit -m "feat: add authorized website inquiry review API"

---

## Task 8: Rank explainable contact and event-profile suggestions

**Files:**

- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-matching.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-matching.test.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-match-repository.ts
- Modify: artifacts/api-server/src/routes/website-inquiries.ts
- Modify: artifacts/api-server/src/routes/website-inquiries.test.ts

- [ ] **Step 1: Write deterministic failing unit tests**

Reuse normalizeMatchingText and normalizeMatchingEmail from features/act-migration/matching-normalization.ts. Test:

- exact email ranks above all name-only contacts;
- normalized full-name equality ranks above fuzzy similarity;
- Levenshtein similarity below 0.72 is excluded;
- a relationship to a likely event profile adds a reason, not an automatic merge;
- event exact normalized name ranks above location/date-only candidates;
- City, ST parsing recognizes a two-letter state;
- dates within 30 days add a proximity reason, farther dates do not;
- ties sort by normalized display name then UUID for stable output;
- manual search returns bounded contact or organization results without changing CRM data.

The response shape is:

~~~ts
type MatchCandidate = {
  id: string;
  label: string;
  score: number;
  reasons: string[];
  context: Record<string, string | null>;
};
type WebsiteInquiryMatches = {
  contacts: MatchCandidate[];
  organizations: MatchCandidate[];
  parsedLocation: { city: string; region: string } | null;
};
~~~

- [ ] **Step 2: Run and confirm red**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-matching.test.ts src/routes/website-inquiries.test.ts

Expected: FAIL because matching does not exist.

- [ ] **Step 3: Implement candidate retrieval and scoring**

The repository retrieves exact normalized email candidates plus bounded name-token candidates, related organization names, organization city/region, and bookings within 60 days of the submitted date. Cap raw candidates at 100 per entity and returned suggestions at 10.

Score contact evidence as exact email 100, normalized name equality 70, fuzzy name up to 60, relationship 15. Score organization evidence as normalized name equality 80, fuzzy name up to 65, city/region 20, date proximity up to 20, matched-contact relationship 15. Include a plain-English reason for every nonzero component.

- [ ] **Step 4: Add the protected endpoints**

Add GET /website-inquiries/:inquiryId/matches and GET /website-inquiries/search?entity=contact|organization&q={text} under the same dual-auth middleware. Search requires at least two trimmed characters, returns at most 20 MatchCandidate rows, and exposes only names, email/location context, and record IDs needed for selection. Return no suggested candidate if its only evidence is below threshold, and never update CRM data from either endpoint.

- [ ] **Step 5: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/website-inquiry-matching.test.ts src/routes/website-inquiries.test.ts
    pnpm --filter @workspace/api-server typecheck
    git add artifacts/api-server/src/features/website-inquiries artifacts/api-server/src/routes/website-inquiries*
    git commit -m "feat: suggest profile matches for website inquiries"

---

## Task 9: Convert one inquiry into CRM records in one idempotent transaction

**Files:**

- Create: artifacts/api-server/src/features/website-inquiries/next-business-day.ts
- Create: artifacts/api-server/src/features/website-inquiries/next-business-day.test.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-conversion.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-conversion.test.ts
- Create: artifacts/api-server/src/features/website-inquiries/website-inquiry-conversion.pglite.test.ts
- Modify: artifacts/api-server/src/routes/website-inquiries.ts
- Modify: artifacts/api-server/src/routes/website-inquiries.test.ts

- [ ] **Step 1: Write failing Denver reminder tests**

Implement test cases for Thursday -> Friday 9:00, Friday -> Monday 9:00, Saturday -> Monday 9:00, and dates on each side of the US daylight-saving transitions. Assert resulting UTC instants while the wall time remains 09:00 America/Denver.

- [ ] **Step 2: Write failing conversion contract tests**

Use a strict discriminated request schema:

~~~ts
{
  contact:
    | { mode: "existing"; id: uuid }
    | { mode: "create"; firstName: 1..100; lastName: 1..100; email?: valid email };
  organization:
    | { mode: "existing"; id: uuid }
    | { mode: "create"; name: 1..240; city?: 1..120; region?: /^[A-Z]{2}$/ };
  booking: {
    name: 1..240;
    city: 1..120;
    region: /^[A-Z]{2}$/;
    startsAt?: ISO datetime;
    packageInterest?: string <= 160;
    notes?: string <= 5000;
  };
  nextAction: { kind: "call"; dueAt?: ISO datetime };
}
~~~

Reject missing booking city/region even when the inquiry location could not be parsed.

- [ ] **Step 3: Write failing transactional behavior tests**

Assert the service:

- selects the inquiry FOR UPDATE;
- returns the stored conversion IDs immediately when status is converted;
- rejects archived/spam inquiries;
- verifies existing contact and organization IDs;
- creates/reuses contact and organization as selected;
- ensures organizationContacts and bookingContacts relationships;
- creates booking status new_lead and probability possible;
- creates a call follow-up using the Denver default when dueAt is omitted;
- creates a note activity containing reference, package, and public message;
- updates converted IDs/status/timestamps;
- writes one actor-bearing audit entry;
- rolls back all writes on any failure.

The PGlite test launches two concurrent conversions for the same inquiry and asserts one contact (when create was selected), one organization, one booking, one follow-up, and the same response IDs.

- [ ] **Step 4: Run and confirm red**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/next-business-day.test.ts src/features/website-inquiries/website-inquiry-conversion.test.ts src/features/website-inquiries/website-inquiry-conversion.pglite.test.ts

Expected: FAIL because conversion modules are absent.

- [ ] **Step 5: Implement transaction ordering carefully**

Inside database.transaction:

1. Lock and read inquiry.
2. Return existing conversion if already converted.
3. Create organization if requested.
4. Create contact initially without organizationId if requested.
5. Insert organizationContacts with onConflictDoNothing, then update the contact's primary organization if appropriate.
6. Insert booking initially without primaryContactId.
7. Insert bookingContacts primary row, then update booking.primaryContactId.
8. Insert followUp and activity.
9. Mark inquiry converted and record the audit entry.

This ordering respects the existing composite relationship foreign keys.

- [ ] **Step 6: Add route and response**

Add POST /website-inquiries/:inquiryId/convert. Return 200 with:

~~~ts
{
  inquiryId: string;
  contactId: string;
  organizationId: string;
  bookingId: string;
  followUpId: string;
  alreadyConverted: boolean;
}
~~~

Map schema errors to 400, missing selected records to 404, invalid status to 409, and unexpected transaction failures to a generic 500 without partial IDs.

- [ ] **Step 7: Rerun and commit**

    pnpm --filter @workspace/api-server test -- src/features/website-inquiries/next-business-day.test.ts src/features/website-inquiries/website-inquiry-conversion.test.ts src/features/website-inquiries/website-inquiry-conversion.pglite.test.ts src/routes/website-inquiries.test.ts
    pnpm --filter @workspace/api-server typecheck
    git add artifacts/api-server/src/features/website-inquiries artifacts/api-server/src/routes/website-inquiries*
    git commit -m "feat: convert reviewed inquiries into CRM leads"

---

## Task 10: Build the shared owner and Office inbox experience

**Files:**

- Create: artifacts/adventure-zone/src/features/website-inquiries/types.ts
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-api.ts
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-inbox.tsx
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-inbox.test.tsx
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-detail.tsx
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-detail.test.tsx
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-convert-dialog.tsx
- Create: artifacts/adventure-zone/src/features/website-inquiries/website-inquiry-convert-dialog.test.tsx
- Create: artifacts/adventure-zone/src/pages/WebsiteInquiriesPage.tsx
- Create: artifacts/adventure-zone/src/pages/OfficeWebsiteInquiriesPage.tsx
- Modify: artifacts/adventure-zone/src/App.tsx
- Modify: artifacts/adventure-zone/src/App.office-routing.test.tsx

- [ ] **Step 1: Write failing list/detail tests**

Using Testing Library and a fake WebsiteInquiryApi, cover:

- initial loading skeleton;
- newest-first rows and status filter tabs;
- empty, load error, and retry states;
- selecting a row loads complete message, alert state, audit history, and suggestions;
- an inquiry query-string value opens that detail directly from either email link;
- begin review/archive/spam/restore refresh list, detail, and count;
- converted detail links to contact, profile, and booking;
- controls have visible labels, keyboard focus, and aria-live success/error feedback.

- [ ] **Step 2: Write failing conversion-dialog tests**

Cover suggestion selection, manual search result selection, create-new contact/profile fields, required city and two-letter state, prefilled inquiry data, editable due time, confirmation summary, submission disabling, server failure retention, and success links.

- [ ] **Step 3: Run and confirm red**

    pnpm --filter @workspace/adventure-zone exec vitest run src/features/website-inquiries/website-inquiry-inbox.test.tsx src/features/website-inquiries/website-inquiry-detail.test.tsx src/features/website-inquiries/website-inquiry-convert-dialog.test.tsx src/App.office-routing.test.tsx

Expected: FAIL because components and routes are absent.

- [ ] **Step 4: Implement one shared UI with auth adapters**

Define:

~~~ts
export interface WebsiteInquiryApi {
  get<T>(path: string): Promise<T>;
  patch<T>(path: string, body: unknown): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
}
~~~

WebsiteInquiriesPage adapts apiGet/apiPatch/apiPost. OfficeWebsiteInquiriesPage adapts officeGet/officePatch/officePost. Both render the same inbox component, so behavior does not drift.

Use TanStack Query keys ["website-inquiries", status], ["website-inquiry", id], ["website-inquiry-matches", id], and ["website-inquiry-count"]. Invalidate all four after a state mutation or conversion.

- [ ] **Step 5: Add routes**

Lazy-load and register:

~~~text
/website-inquiries
/office/website-inquiries
~~~

The Office route may render only when OfficeIdentity.canReviewWebsiteInquiries is true; otherwise redirect to /office. The API remains the security boundary.

- [ ] **Step 6: Rerun and commit**

    pnpm --filter @workspace/adventure-zone exec vitest run src/features/website-inquiries/website-inquiry-inbox.test.tsx src/features/website-inquiries/website-inquiry-detail.test.tsx src/features/website-inquiries/website-inquiry-convert-dialog.test.tsx src/App.office-routing.test.tsx
    pnpm --filter @workspace/adventure-zone typecheck
    git add artifacts/adventure-zone/src
    git commit -m "feat: add website inquiry review inbox"

---

## Task 11: Add permission-aware navigation, badges, and Amy's admin toggle

**Files:**

- Modify: artifacts/adventure-zone/src/lib/office-auth-context.tsx
- Modify: artifacts/adventure-zone/src/components/office/office-shell.tsx
- Create: artifacts/adventure-zone/src/components/office/office-shell.test.tsx
- Modify: artifacts/adventure-zone/src/components/navigation/app-shell.tsx
- Modify: artifacts/adventure-zone/src/components/navigation/app-menu.tsx
- Modify: artifacts/adventure-zone/src/components/navigation/app-shell.test.tsx
- Create: artifacts/adventure-zone/src/components/navigation/app-menu.test.tsx
- Modify: artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.tsx
- Modify: artifacts/adventure-zone/src/pages/OfficeCoordinatorAdminPage.test.tsx

- [ ] **Step 1: Write failing identity/navigation tests**

Assert OfficeIdentity includes canReviewWebsiteInquiries. With permission true, Office navigation contains Website Inquiries and polls /website-inquiries/count; with false, it has neither link nor count request. Show a badge only when newCount > 0 and cap display at 99+.

For owner navigation, assert the booking workspace link is visible on desktop and in the More/mobile menu, and the new-count badge updates on the existing 15-second polling cadence.

- [ ] **Step 2: Write failing account-admin test**

Extend OfficeCoordinatorAdminPage.test.tsx or replace its source-only assertion with a focused render test. Assert the Account panel contains a Website inquiries switch, reflects the account value, and PATCHes:

~~~ts
{ canReviewWebsiteInquiries: true }
~~~

The label explains that the permission reveals public contact details and permits conversion.

- [ ] **Step 3: Run and confirm red**

    pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-shell.test.tsx src/components/navigation/app-shell.test.tsx src/components/navigation/app-menu.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx

Expected: FAIL because identity, navigation, badges, and toggle are absent.

- [ ] **Step 4: Implement navigation and admin control**

Add Inbox to lucide icons. Keep the current messages badge. Fetch inquiry count independently so one failed badge request does not clear the other. On Office mobile, use a horizontally scrollable nav or responsive grid sized from visible items so adding a permission-only item does not overflow.

Thread the permission through stored Office login identity and /office/auth/me refresh. Do not infer permission from displayName.

- [ ] **Step 5: Rerun and commit**

    pnpm --filter @workspace/adventure-zone exec vitest run src/components/office/office-shell.test.tsx src/components/navigation/app-shell.test.tsx src/components/navigation/app-menu.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx
    pnpm --filter @workspace/adventure-zone typecheck
    git add artifacts/adventure-zone/src
    git commit -m "feat: expose inquiry inbox to authorized staff"

---

## Task 12: Host the Wix custom element, verify production readiness, and prepare gated deployment

**Files:**

- Create: artifacts/adventure-zone/public/adventure-zone-site.js
- Create: artifacts/adventure-zone/src/website-custom-element/adventure-zone-site.contract.test.ts
- Modify: render.yaml
- Create: docs/website-inquiry-inbox-runbook.md

- [ ] **Step 1: Copy the approved visual implementation into the static public tree**

Use the current workspace file ../adventure-zone-site.js as the source of the visual markup, styles, images, sections, video URL, resize signaling, and responsive behavior. The repository copy under artifacts/adventure-zone/public becomes canonical. Do not redesign or omit sections during this task.

- [ ] **Step 2: Write failing jsdom contract tests**

Load public/adventure-zone-site.js in jsdom and test:

- customElements.get("adventure-zone-site") is registered;
- fetch targets https://adventure-zone-command-center.onrender.com/api/public/website-inquiries;
- payload contains submissionId, all form fields, website, and pageUrl;
- one crypto.randomUUID value is reused after a failed request;
- button is disabled and says Sending while pending;
- success resets fields and the retry UUID;
- timeout/network/4xx/5xx keeps field values and renders a visible mailto:TheAdventureZone12@gmail.com link;
- failure never assigns window.location.href;
- source contains neither replit.app nor secret-like DATABASE_URL, SESSION_SECRET, SMTP password, or recipient configuration strings.

- [ ] **Step 3: Run and confirm red**

    pnpm --filter @workspace/adventure-zone exec vitest run src/website-custom-element/adventure-zone-site.contract.test.ts

Expected: FAIL because the hosted copy still has the mail-client-only submit behavior or is absent.

- [ ] **Step 4: Implement bounded asynchronous submission**

In the custom element:

~~~js
const INQUIRY_API_URL =
  "https://adventure-zone-command-center.onrender.com/api/public/website-inquiries";
const INQUIRY_TIMEOUT_MS = 12000;
~~~

Make submitInquiry async. Generate this.pendingSubmissionId only when absent, use AbortController, send Content-Type application/json, and require response.ok. Disable only the form submit button while pending. On success, reset, clear pendingSubmissionId, and announce the server message/reference. On failure, preserve all values and render escaped text plus a clickable fallback email link. Restore the button in finally.

Keep the adventure-zone-inquiry custom event as a non-cancelable informational event after a successful API save; do not let a missing Wix listener bypass the API.

- [ ] **Step 5: Add Render configuration and runbook**

Under the existing API service envVars in render.yaml add:

~~~yaml
- key: WEBSITE_INQUIRY_ALLOWED_ORIGINS
  value: https://the-adventure-zone.com,https://www.the-adventure-zone.com
- key: WEBSITE_INQUIRY_ALERT_RECIPIENTS
  sync: false
- key: WEBSITE_INQUIRY_INBOX_BASE_URL
  value: https://adventure-zone-command-center-1.onrender.com
~~~

The runbook must include:

1. Local focused test commands.
2. Render API/static service URLs and health/script checks.
3. How the owner grants Amy the Website inquiries permission.
4. Wix Source = Server URL, exact script URL, and tag adventure-zone-site.
5. Preview without submitting.
6. A clearly labeled production smoke inquiry and how to archive it.
7. Rollback: restore the previous Wix custom element source while leaving saved inquiries intact.
8. Stop Replit only after Render and Wix production are verified.

- [ ] **Step 6: Run full automated verification**

Run:

    pnpm --filter @workspace/db build
    pnpm --filter @workspace/api-server test -- src/features/website-inquiries src/routes/public-website-inquiries.test.ts src/routes/website-inquiries.test.ts
    pnpm --filter @workspace/adventure-zone exec vitest run src/features/website-inquiries src/website-custom-element/adventure-zone-site.contract.test.ts src/components/office/office-shell.test.tsx src/components/navigation/app-shell.test.tsx src/components/navigation/app-menu.test.tsx src/pages/OfficeCoordinatorAdminPage.test.tsx src/App.office-routing.test.tsx
    pnpm --filter @workspace/api-server typecheck
    pnpm --filter @workspace/adventure-zone typecheck
    pnpm --filter @workspace/api-server build
    pnpm --filter @workspace/adventure-zone build
    git diff --check

Expected: every command exits 0.

- [ ] **Step 7: Perform a security and placeholder review**

Run:

    git grep -n -E "TODO|TBD|FIXME|replit\\.app|DATABASE_URL|SESSION_SECRET|SMTP.*PASS" -- artifacts/adventure-zone/public/adventure-zone-site.js artifacts/api-server/src/features/website-inquiries docs/website-inquiry-inbox-runbook.md
    git diff --stat
    git status --short

Expected: no TODO/TBD/FIXME, no Replit runtime URL, no secret in public JS, and only intended files changed. Server source may mention environment variable names; values must remain server-side.

- [ ] **Step 8: Commit the verified implementation**

    git add artifacts/adventure-zone/public/adventure-zone-site.js artifacts/adventure-zone/src/website-custom-element render.yaml docs/website-inquiry-inbox-runbook.md
    git commit -m "feat: host Wix site and connect inquiry inbox"

- [ ] **Step 9: Stop at the external-change gate**

Present the full verification output and current commit list. Ask for explicit approval before git push and Render deployment. Do not combine this approval with Wix publishing approval.

- [ ] **Step 10: After push/deploy approval, verify Render read-only endpoints**

After the approved push and automatic Render deploy:

    Invoke-WebRequest -UseBasicParsing 'https://adventure-zone-command-center.onrender.com/api/healthz'
    Invoke-WebRequest -UseBasicParsing 'https://adventure-zone-command-center-1.onrender.com/adventure-zone-site.js'

Expected: API health JSON is healthy; script returns 200, JavaScript content type, contains adventure-zone-site, and contains no replit.app.

Configure the three Render environment values. Grant Amy's account the dedicated permission through the owner Account panel. These are approved deployment operations but do not yet publish Wix.

- [ ] **Step 11: Stop at the Wix-edit gate**

Ask for confirmation before changing the Wix custom-element source or deleting the temporary diagnostic element. Once approved, set Source to Server URL, paste:

    https://adventure-zone-command-center-1.onrender.com/adventure-zone-site.js

and set tag:

    adventure-zone-site

Remove the temporary diagnostic element only after confirming it is the diagnostic copy.

- [ ] **Step 12: Preview, then stop at the publish gate**

Use Wix Preview to inspect desktop and mobile layout without submitting. Ask separately for final confirmation immediately before Publish.

After publish approval, publish, submit exactly one inquiry labeled Website integration smoke test from the production site, verify owner and permitted Office views, match suggestions, badge, and alert state, then archive that inquiry. Only after all checks pass ask whether to stop the paid Replit deployment.

---

## Final Acceptance Checklist

- [ ] The script loads from Render at /adventure-zone-site.js with no Replit dependency.
- [ ] The public API rejects bad origins, bad page URLs, honeypots, unknown fields, oversized bodies, and rate-limit excess.
- [ ] Repeated submission IDs and recent identical content create only one inquiry.
- [ ] Public submission does not write to CRM tables.
- [ ] Alert failure never loses or rejects a saved inquiry.
- [ ] Owner/admin and explicitly permitted Office users can review; all other roles are denied by API.
- [ ] Matching is explainable and advisory only.
- [ ] Conversion is transactional, retry-safe, and creates one contact/profile relationship, one new_lead booking, one follow-up, one activity, and an audit record.
- [ ] The default follow-up is 9:00 AM on the next America/Denver business day.
- [ ] Navigation badges count only new inquiries.
- [ ] Amy's access is granted by the permission toggle, never by a hardcoded name.
- [ ] Automated tests, typechecks, builds, git diff --check, Render health, hosted script, Wix Preview, and one archived production smoke inquiry all pass.
- [ ] Wix publishing and stopping Replit each occur only after their own explicit confirmation.
