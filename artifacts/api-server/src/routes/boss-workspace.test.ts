import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFileSync(path.resolve(process.cwd(), "src/routes", name), "utf8");

describe("Boss workspace route boundaries", () => {
  it("derives dashboard review, wrap-up, and checklist summaries from persisted records", () => {
    const dashboard = source("boss-dashboard.ts");
    expect(dashboard).toContain("eventManagerReviews");
    expect(dashboard).toContain("eventChecklistRuns");
    expect(dashboard).toContain("eventLegLifecycle");
    expect(dashboard).toContain("reviewsDue");
    expect(dashboard).not.toContain("reviewAndWrapUp: []");
    expect(dashboard).not.toContain("checklistAndMaintenance: []");
    expect(dashboard).toContain('router.get("/boss/maintenance/:runId", requireBoss');
    expect(dashboard).toContain('router.delete("/boss/maintenance/:runId", requireBoss');
    expect(dashboard).toContain('router.delete("/boss/reviews/due/:bookingId", requireBoss');
    expect(dashboard).toContain("event_manager_review_dismissals");
  });
  it("boss leg controls require Boss authentication and validate mutable inputs", () => {
    const operations = source("boss-operations.ts");
    expect(operations).toContain('router.get("/boss/legs", requireBoss');
    expect(operations).toContain('router.patch("/boss/legs/:legId", requireBoss');
    expect(operations).toContain('router.put("/boss/bookings/:bookingId/leg", requireBoss');
    expect(operations).toContain("defaultMpg: z.number().positive()");
    expect(operations).toContain("sortOrder is intentionally not writable");
    expect(operations).toContain("Travel leg not found.");
  });
  it("protects Boss booking date ordering for partial edits", () => {
    const operations = source("boss-operations.ts");
    expect(operations).toContain("effectiveStart");
    expect(operations).toContain("effectiveEnd");
    expect(operations).toContain("End date cannot be before the start date.");
  });
  it("admin account responses are explicitly public-field filtered", () => {
    const admin = source("boss-admin-accounts.ts");
    expect(admin).toContain("const publicAccount");
    expect(admin).toContain("accounts: await repository.list()");
    expect(admin).toContain("res.json({ accounts: await repository.list() })");
    expect(admin).toContain("res.status(201).json({ account: publicAccount");
    expect(admin).toContain("studioOfficeAccountId: z.string().uuid().nullable().optional()");
    expect(admin).toContain("That Boss username is already in use.");
  });
  it("keeps business documents inside the mapped Boss Office workspace", () => {
    const documents = source("boss-documents.ts");
    const certificates = source("coi-certificates.ts");
    expect(documents).toContain('router.get("/boss/documents", requireBoss');
    expect(documents).toContain("req.bossAccount!.studioOfficeAccountId");
    expect(documents).toContain("eq(designProjects.officeAccountId, officeAccountId)");
    expect(documents).toContain("eq(officeEmailDrafts.officeAccountId, officeAccountId)");
    expect(certificates).toContain('router.get("/boss/coi", requireBoss');
    expect(certificates).toContain("eq(designAssets.uploadedByAccountId, officeAccountId)");
    expect(certificates).toContain('router.get("/admin/coi", requireOwnerMiddleware');
  });
});