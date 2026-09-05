import { describe, expect, it } from "vitest";
import { classify, parseCertificateFilterQuery } from "./coi-certificates";

describe("COI expiration classification", () => {
  it("distinguishes missing files and dates from usable certificates", () => {
    expect(classify(null, "asset", "2026-09-05")).toBe("incomplete");
    expect(classify("2026-09-20", null, "2026-09-05")).toBe("incomplete");
    expect(classify("2026-09-06", "asset", "2026-09-05")).toBe("expiring_soon");
  });

  it("uses inclusive thirty-day and expiry boundaries", () => {
    expect(classify("2026-09-05", "asset", "2026-09-05")).toBe("expiring_soon");
    expect(classify("2026-10-05", "asset", "2026-09-05")).toBe("expiring_soon");
    expect(classify("2026-10-06", "asset", "2026-09-05")).toBe("current");
    expect(classify("2026-09-04", "asset", "2026-09-05")).toBe("expired");
  });
});

describe("admin certificate filters", () => {
  it("defaults omitted filters to the complete certificate register", () => {
    const result = parseCertificateFilterQuery({});
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toEqual({
      expirationState: "all",
      reviewState: "all",
    });
  });

  it("accepts renewal, review, and workspace filters together", () => {
    const result = parseCertificateFilterQuery({
      expirationState: "expiring_soon",
      reviewState: "needs_review",
      officeAccountId: "3b956bd2-88de-4bf2-8f01-58f84d4fd873",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown renewal states and invalid workspace ids", () => {
    expect(parseCertificateFilterQuery({ expirationState: "overdue" }).success).toBe(false);
    expect(parseCertificateFilterQuery({ officeAccountId: "not-a-workspace" }).success).toBe(false);
  });
});