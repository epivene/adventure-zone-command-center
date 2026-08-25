import { describe, expect, it, vi } from "vitest";

import { PostgresGoogleValidationRepository } from "./google-validation-repository";

function postgresError(code: string) {
  return Object.assign(new Error("database failure"), { code });
}

function poolThatFailsAt(stage: "update" | "mapping" | "audit") {
  const query = vi.fn(async (text: string) => {
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (text.includes("SELECT id") && text.includes("FROM organizations")) {
      return { rows: [{ id: "org-id" }] };
    }
    if (text.includes("UPDATE google_workspace_validation_review_items")) {
      if (stage === "update") throw postgresError("42703");
      return { rows: [{ thread_id: "thread-id", evidence_codes: [] }] };
    }
    if (text.includes("INSERT INTO google_workspace_validation_mappings")) {
      if (stage === "mapping") throw postgresError("23503");
      return { rows: [] };
    }
    if (text.includes("INSERT INTO google_workspace_audit_events")) {
      if (stage === "audit") throw postgresError("42P01");
      return { rows: [] };
    }
    return { rows: [] };
  });
  return { query };
}

async function expectDiagnostic(stage: "update" | "mapping" | "audit", expected: string, pgCode: string) {
  const repository = new PostgresGoogleValidationRepository(poolThatFailsAt(stage));
  await expect(repository.resolveReviewItem({
    messageId: "message-id",
    organizationId: "org-id",
    actorId: "owner",
    now: new Date("2026-08-25T13:40:00Z"),
  })).rejects.toMatchObject({
    message: expected,
    stage,
    postgresCode: pgCode,
  });
}

describe("Google review assignment diagnostics", () => {
  it("identifies review-row update failures without exposing SQL/data", async () => {
    await expectDiagnostic("update", "GOOGLE_WORKSPACE_REVIEW_UPDATE_FAILED", "42703");
  });

  it("identifies mapping upsert failures without exposing SQL/data", async () => {
    await expectDiagnostic("mapping", "GOOGLE_WORKSPACE_REVIEW_MAPPING_FAILED", "23503");
  });

  it("identifies audit insert failures without exposing SQL/data", async () => {
    await expectDiagnostic("audit", "GOOGLE_WORKSPACE_REVIEW_AUDIT_FAILED", "42P01");
  });

  it("casts the audit organization id before passing it to jsonb_build_object", async () => {
    const queries: string[] = [];
    const pool = {
      query: vi.fn(async (text: string) => {
        queries.push(text);
        if (text.includes("FROM google_workspace_connections")) {
          return { rows: [{ id: "connection-id" }] };
        }
        if (text.includes("SELECT id") && text.includes("FROM organizations")) {
          return { rows: [{ id: "org-id" }] };
        }
        if (text.includes("UPDATE google_workspace_validation_review_items")) {
          return { rows: [{ thread_id: "thread-id", evidence_codes: [] }] };
        }
        return { rows: [] };
      }),
    };
    const repository = new PostgresGoogleValidationRepository(pool);

    await repository.resolveReviewItem({
      messageId: "message-id",
      organizationId: "org-id",
      actorId: "owner",
      now: new Date("2026-08-25T14:05:00Z"),
    });

    const auditSql = queries.find((text) =>
      text.includes("INSERT INTO google_workspace_audit_events"),
    );
    expect(auditSql).toContain("jsonb_build_object('organizationId', $3::text)");
  });
});
