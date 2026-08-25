import { describe, expect, it } from "vitest";

import { GoogleMatchedEmailCorrectionService } from "./google-matched-email-correction-service";

class FakePool {
  queries: Array<{ text: string; values?: unknown[] }> = [];
  async query(text: string, values?: unknown[]) {
    this.queries.push({ text, values });
    if (text.includes("FROM google_workspace_connections")) return { rows: [{ id: "conn-1" }] };
    if (text.includes("FROM organizations")) return { rows: [{ id: values?.[0] }] };
    return { rows: [] };
  }
}

const base = {
  messageId: "m1",
  threadId: "t1",
  subject: "Paint order",
  from: "store@example.com",
  to: "theadventurezone12@gmail.com",
  internalDateMs: 1,
  hasAttachments: false,
  actorId: "owner",
  now: new Date("2026-08-25T12:00:00Z"),
};

describe("GoogleMatchedEmailCorrectionService", () => {
  it("persists a manual profile override so reconciliation can preserve it", async () => {
    const pool = new FakePool();
    const service = new GoogleMatchedEmailCorrectionService(pool as never);

    await service.assign({ ...base, organizationId: "11111111-1111-4111-8111-111111111111" });

    const sql = pool.queries.map((query) => query.text).join("\n");
    expect(sql).toContain("google_workspace_validation_review_items");
    expect(sql).toContain("review_state");
    expect(sql).toContain("'resolved'");
    expect(sql).toContain("manual_profile_assignment");
    expect(sql).toContain("google_workspace_validation_mappings");
  });

  it("persists a manual ignore and removes any existing mapping", async () => {
    const pool = new FakePool();
    const service = new GoogleMatchedEmailCorrectionService(pool as never);

    await service.ignore(base);

    const sql = pool.queries.map((query) => query.text).join("\n");
    expect(sql).toContain("'ignored'");
    expect(sql).toContain("DELETE FROM google_workspace_validation_mappings");
  });
});
