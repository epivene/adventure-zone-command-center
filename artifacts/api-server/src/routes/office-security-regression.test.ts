import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueToken, verifyToken } from "@/lib/auth";
import { issueLegManagerToken, verifyLegManagerToken } from "@/features/leg-manager/leg-manager-auth";
import { issueOfficeToken, verifyOfficeToken } from "@/features/office/office-auth";
import { officeContactInputSchema, officeLocationInputSchema, officeProfileInputSchema } from "@/features/office/office-profile-input";

const priorSecret = process.env.SESSION_SECRET;
const repoRoot = path.resolve(process.cwd(), "../..");

beforeEach(() => { process.env.SESSION_SECRET = "office-security-test-secret"; });
afterEach(() => { if (priorSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = priorSecret; });

describe("Office Coordinator security regression", () => {
  it("keeps owner, leg-manager, and office bearer tokens cryptographically separate", () => {
    const office = issueOfficeToken({ accountId: "10000000-0000-4000-8000-000000000001", sessionVersion: 1 })!;
    const manager = issueLegManagerToken({ legId: "20000000-0000-4000-8000-000000000001", sessionVersion: 1 })!;
    const owner = issueToken()!;
    expect(verifyOfficeToken(office.token)?.accountId).toBe("10000000-0000-4000-8000-000000000001");
    expect(verifyToken(office.token)).toBe(false);
    expect(verifyLegManagerToken(office.token)).toBeNull();
    expect(verifyOfficeToken(owner.token)).toBeNull();
    expect(verifyOfficeToken(manager.token)).toBeNull();
  });

  it("mounts allowlisted office routes before owner auth and office-admin routes after owner auth", () => {
    const source = readFileSync(path.join(repoRoot, "artifacts/api-server/src/routes/index.ts"), "utf8");
    const ownerGate = source.indexOf("router.use(requireOwnerMiddleware)");
    for (const route of [
      "officeAuthRouter",
      "officeTasksRouter",
      "officeProfilesRouter",
      "officeEventFamiliesRouter",
      "officeMailRouter",
      "officeEmailDraftsRouter",
      "officeMessagesRouter",
    ]) {
      expect(source.indexOf(`router.use(${route})`)).toBeGreaterThan(-1);
      expect(source.indexOf(`router.use(${route})`)).toBeLessThan(ownerGate);
    }
    for (const route of [
      "officeAdminAccountsRouter",
      "officeAdminTasksRouter",
      "officeAdminMailRouter",
      "officeAdminEmailDraftsRouter",
      "officeAdminMessagesRouter",
      "officeAdminHistoryRouter",
    ]) {
      expect(source.indexOf(`router.use(${route})`)).toBeGreaterThan(ownerGate);
    }
  });

  it("has no Office Coordinator outbound-send endpoint", () => {
    const source = readFileSync(path.join(repoRoot, "artifacts/api-server/src/routes/office-email-drafts.ts"), "utf8");
    expect(source).not.toMatch(/\/office\/email-drafts\/[^"]*\/send/);
    const ownerSource = readFileSync(path.join(repoRoot, "artifacts/api-server/src/routes/office-admin-email-drafts.ts"), "utf8");
    expect(ownerSource).toContain('/office-admin/email-drafts/:draftId/send');
  });

  it("allows Office and Dave to save any manual contact email value", () => {
    const base = {
      firstName: "Rocky Mountain Train Show",
      lastName: "",
      jobTitle: null,
      relationshipRole: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      phones: [],
    };

    expect(officeContactInputSchema.parse({
      ...base,
      email: "Information@RockyMountainTrainShow.com",
    }).email).toBe("information@rockymountaintrainshow.com");
    expect(officeContactInputSchema.parse({
      ...base,
      email: "Use the website contact form",
    }).email).toBe("use the website contact form");
  });

  it("continues to validate location email fields separately", () => {
    expect(officeLocationInputSchema.safeParse({
      email: "Use the website contact form",
    }).success).toBe(false);
    expect(officeLocationInputSchema.parse({
      email: "Information@RockyMountainTrainShow.com",
    }).email).toBe("information@rockymountaintrainshow.com");
  });

  it("rejects strategic and operational fields from factual Office edit schemas", () => {
    expect(officeProfileInputSchema.safeParse({ name: "Fair", lastResort: true }).success).toBe(false);
    expect(officeProfileInputSchema.safeParse({ name: "Fair", probability: "likely" }).success).toBe(false);
    expect(officeLocationInputSchema.safeParse({ label: "Grounds", travelLegId: "20000000-0000-4000-8000-000000000001" }).success).toBe(false);
    expect(officeLocationInputSchema.safeParse({ label: "Grounds", lat: 47.1, lng: -102.4 }).success).toBe(false);
    expect(officeContactInputSchema.safeParse({ firstName: "Amy", lastName: "Example", jobTitle: null, relationshipRole: null, email: null, address1: null, address2: null, city: null, region: null, postalCode: null, phones: [], organizationId: "10000000-0000-4000-8000-000000000001" }).success).toBe(false);
  });
});
