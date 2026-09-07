import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "CoiManagementPage.tsx"), "utf8");

describe("COI management workflow states", () => {
  it("renders actionable loading, empty, unavailable-workspace, save-error, and unavailable-file states", () => {
    expect(source).toContain("<Skeleton");
    expect(source).toContain("No certificates recorded yet");
    expect(source).toContain("Document workspace unavailable");
    expect(source).toContain("Could not save the certificate");
    expect(source).toContain("File unavailable");
    expect(source).toContain("Refresh");
  });

  it("keeps Boss and Admin mutations on their protected authorization paths", () => {
    expect(source).toContain('bossPatch(`/boss/coi/${initial.id}`, payload)');
    expect(source).toContain('apiPatch(`/admin/coi/${initial.id}`, payload)');
    expect(source).toContain('bossPost("/boss/coi", payload)');
    expect(source).toContain('apiPost("/admin/coi", payload)');
  });

  it("exposes the four expiration states and separate review state", () => {
    expect(source).toContain('status === "current"');
    expect(source).toContain('status === "expiring_soon"');
    expect(source).toContain('status === "expired"');
    expect(source).toContain('"needs_review" | "reviewed"');
    expect(source).toContain('value="needs_review"');
    expect(source).toContain('value="reviewed"');
  });

  it("persists Admin renewal, review, and workspace filters in the URL", () => {
    expect(source).toContain('params.set(key, value)');
    expect(source).toContain('"expirationState"');
    expect(source).toContain('"reviewState"');
    expect(source).toContain('"officeAccountId"');
    expect(source).toContain("useSearch()");
    expect(source).toContain("useLocation()");
  });

  it("sends active filters to the owner-only COI endpoint", () => {
    expect(source).toContain('adminParams.set("expirationState", expirationFilter)');
    expect(source).toContain('adminParams.set("reviewState", reviewFilter)');
    expect(source).toContain('adminParams.set("officeAccountId", workspaceFilter)');
    expect(source).toContain("`/admin/coi?${adminParams.toString()}`");
  });

  it("distinguishes an empty register from filters with no matches", () => {
    expect(source).toContain("No certificates match these filters");
    expect(source).toContain("Clear filters");
    expect(source).toContain("No certificates recorded yet");
  });

  it("opens canonical owner COIs through the protected document service", () => {
    expect(source).toContain("businessDocumentsApi.open(certificate.documentId)");
    expect(source).toContain("if (certificate.fileUrl) window.open(certificate.fileUrl");
  });
});
