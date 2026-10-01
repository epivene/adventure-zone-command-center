import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), select: vi.fn(), where: vi.fn(), mappings: vi.fn(), owns: vi.fn(), thread: vi.fn(), listProfiles: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: { select: mocks.select }, pool: {} }));
vi.mock("@/features/boss/boss-account-repository", () => ({ DrizzleBossAccountRepository: class { getActiveSession = mocks.session; } }));
vi.mock("@/features/office/office-profile-service", () => ({ OfficeProfileService: class {} }));
vi.mock("@/features/google-workspace/google-profile-email-archive-service", () => ({ GoogleProfileEmailArchiveService: class { archiveApprovedThread = mocks.thread; } }));
vi.mock("@/features/google-workspace/google-profile-label-validation-import", () => ({ GoogleProfileLabelValidationImportService: class { async reconcileOrganization() { return []; } } }));
vi.mock("@/features/boss/boss-profile-view", () => ({ listBossProfileDirectory: mocks.listProfiles }));
vi.mock("@/features/google-workspace/google-validation-repository", () => ({ PostgresGoogleValidationRepository: class { listApprovedForOrganization = mocks.mappings; organizationOwnsApprovedThread = mocks.owns; } }));
import { issueBossToken } from "@/features/boss/boss-auth";
import router from "./boss-profiles";
const profileId = "10000000-0000-4000-8000-000000000001";
const accountId = "10000000-0000-4000-8000-000000000002";
const app = express(); app.use(express.json(), router);
function auth() { return `Bearer ${issueBossToken({ accountId, sessionVersion: 1 })!.token}`; }
beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "boss-email-test-secret");
  vi.clearAllMocks();
  mocks.session.mockResolvedValue({ id: accountId, role: "boss", sessionVersion: 1, displayName: "Dave", studioOfficeAccountId: null });
  mocks.select.mockReturnValue({ from: () => ({ where: mocks.where }) });
  mocks.where.mockReturnValue({ orderBy: async () => [{ id: "draft-1", subject: "Fair plans", body: "Draft body", state: "draft" }] });
  mocks.mappings.mockResolvedValue([]);
  mocks.owns.mockResolvedValue(true);
  mocks.thread.mockResolvedValue({ id: "saved-thread-1", subject: "Fair plans", archiveState: "complete", messages: [] });
  mocks.listProfiles.mockResolvedValue({ records: [], families: [], travelLegs: [], total: 0, page: 1, pageSize: 50, pageCount: 1 });
});
afterEach(() => vi.unstubAllEnvs());
it("requires an active Boss session for both drafts and conversations", async () => {
  for (const path of [`/boss/profiles/${profileId}/email-drafts`, `/boss/google-workspace/profiles/${profileId}/emails`]) {
    expect((await request(app).get(path)).status).toBe(401);
    mocks.session.mockResolvedValueOnce(null);
    expect((await request(app).get(path).set("Authorization", auth())).status).toBe(401);
  }
  expect(mocks.select).not.toHaveBeenCalled();
  expect(mocks.mappings).not.toHaveBeenCalled();
});
it("shows owner and coordinator drafts scoped to the requested profile, without an Office account", async () => {
  const response = await request(app).get(`/boss/profiles/${profileId}/email-drafts`).set("Authorization", auth());
  expect(response.status).toBe(200);
  expect(response.body.drafts[0].body).toBe("Draft body");
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(query.sql).toContain('"organization_id"');
  expect(query.params).toEqual([profileId]);
  expect(query.sql).not.toContain("office_account_id");
});
it("reuses approved profile matching and rejects unrelated threads", async () => {
  const base = `/boss/google-workspace/profiles/${profileId}/emails`;
  expect((await request(app).get(base).set("Authorization", auth())).status).toBe(200);
  expect(mocks.mappings).toHaveBeenCalledWith(profileId);
  expect((await request(app).get(`${base}/thread-1`).set("Authorization", auth())).status).toBe(200);
  mocks.owns.mockResolvedValueOnce(false);
  expect((await request(app).get(`${base}/other-thread`).set("Authorization", auth())).status).toBe(404);
  expect(mocks.thread).toHaveBeenCalledTimes(1);
  expect(mocks.thread).toHaveBeenCalledWith({ organizationId: profileId, contactId: null, gmailThreadId: "thread-1" });
});
it("does not expose file writes through the Boss read-only router", async () => {
  expect((await request(app).post(`/boss/google-workspace/profiles/${profileId}/threads/thread-1/copy-files`).set("Authorization", auth())).status).toBe(404);
  expect((await request(app).get('/boss/profiles/invalid/email-drafts').set("Authorization", auth())).status).toBe(400);
  expect(mocks.select).not.toHaveBeenCalled();
});

it("uses admin directory sorting and filters within the Boss role", async () => {
  expect((await request(app).get("/boss/profiles?sort=name_desc")).status).toBe(401);
  expect(mocks.listProfiles).not.toHaveBeenCalled();
  const response = await request(app).get("/boss/profiles?sort=name_desc&page=2&pageSize=12&type=fair&lastResort=only&activity=filler").set("Authorization", auth());
  expect(response.status).toBe(200);
  expect(mocks.listProfiles).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
    sort: "name_desc", page: 2, pageSize: 12, placeType: "fair", lastResort: "all", filler: "all", includeRetired: false,
  }));
});
