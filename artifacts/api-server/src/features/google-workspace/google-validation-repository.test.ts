import { describe, expect, it, vi } from "vitest";

import { PostgresGoogleValidationRepository } from "./google-validation-repository";

function poolWith(rowsBySql: (sql: string) => Array<Record<string, unknown>>) {
  const query = vi.fn(async (sql: string, _values?: unknown[]) => ({
    rows: rowsBySql(sql.replace(/\s+/g, " ").trim()),
  }));
  return { pool: { query }, query };
}

describe("PostgresGoogleValidationRepository", () => {
  it("finds message ids already mapped or placed in review", async () => {
    const { pool, query } = poolWith((sql) => {
      if (sql.includes("SELECT id FROM google_workspace_connections")) {
        return [{ id: "connection-1" }];
      }
      if (sql.includes("UNION")) {
        return [{ message_id: "mapped" }, { message_id: "reviewed" }];
      }
      return [];
    });
    const repository = new PostgresGoogleValidationRepository(pool);

    await expect(
      repository.processedMessageIds(["mapped", "reviewed", "new", "mapped"]),
    ).resolves.toEqual(new Set(["mapped", "reviewed"]));
    const lookup = query.mock.calls.find(([sql]) => String(sql).includes("UNION"));
    expect(lookup?.[1]).toEqual(["connection-1", ["mapped", "reviewed", "new"]]);
  });

  it("upserts resolved validation rows idempotently for the active connection", async () => {
    const { pool, query } = poolWith((sql) =>
      sql.includes("SELECT id FROM google_workspace_connections")
        ? [{ id: "connection-1" }]
        : [],
    );
    const repository = new PostgresGoogleValidationRepository(pool);

    await repository.upsertRows([
      {
        messageId: "m1",
        threadId: "t1",
        organizationId: "org-1",
        contactId: "contact-1",
        evidenceCodes: ["exact_contact_email", "contact_active_organization"],
      },
    ]);

    const insert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO google_workspace_validation_mappings"),
    );
    expect(insert).toBeTruthy();
    expect(insert?.[1]).toEqual([
      "connection-1",
      "m1",
      "t1",
      "org-1",
      "contact-1",
      JSON.stringify(["exact_contact_email", "contact_active_organization"]),
    ]);
    expect(String(insert?.[0])).toContain("ON CONFLICT (connection_id, message_id)");
  });

  it("records an owner approval decision without starting historical sync", async () => {
    const { pool, query } = poolWith((sql) =>
      sql.includes("SELECT id FROM google_workspace_connections")
        ? [{ id: "connection-1" }]
        : [],
    );
    const repository = new PostgresGoogleValidationRepository(pool);

    await repository.setDecision({
      status: "approved",
      actorId: "owner-1",
      now: new Date("2026-08-24T17:00:00.000Z"),
    });

    const decision = query.mock.calls.find(([sql]) =>
      String(sql).includes("google_workspace_validation_state"),
    );
    expect(String(decision?.[0])).toContain("validation_status");
    expect(decision?.[1]).toEqual([
      "connection-1",
      "approved",
      "owner-1",
      new Date("2026-08-24T17:00:00.000Z"),
    ]);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SYNC_ENABLED"))).toBe(false);
  });

  it("uses the mutation as the authoritative Gmail sync state", async () => {
    const { pool, query } = poolWith((sql) => {
      if (sql.includes("SELECT id FROM google_workspace_connections")) {
        return [{ id: "connection-1" }];
      }
      if (sql.includes("google_workspace_validation_review_items item")) {
        return [{
          message_id: "m1",
          thread_id: "t1",
          subject: "Fair",
          from_header: "fair@example.com",
          to_header: "zone@example.com",
          internal_date_ms: "1",
          evidence_codes: [],
          candidate_organizations: [],
          has_attachments: false,
          review_state: "resolved",
          resolved_organization_id: "org-1",
          gmail_sync_state: "completed",
          gmail_sync_error_code: null,
          gmail_sync_mutation_id: "mutation-1",
        }];
      }
      return [];
    });
    const repository = new PostgresGoogleValidationRepository(pool);

    await expect(repository.listReviewItems()).resolves.toEqual([
      expect.objectContaining({
        messageId: "m1",
        gmailSyncState: "completed",
        gmailSyncErrorCode: null,
        gmailSyncMutationId: "mutation-1",
      }),
    ]);
    const select = query.mock.calls.find(([sql]) =>
      String(sql).includes("google_workspace_validation_review_items item"),
    );
    expect(String(select?.[0])).toContain("LEFT JOIN google_workspace_gmail_mutations");
    expect(String(select?.[0])).toContain("COALESCE(mutation.state");
  });

  it("normalizes an in-flight mutation to pending", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("SELECT id FROM google_workspace_connections")) {
        return [{ id: "connection-1" }];
      }
      return [{
        message_id: "m1",
        thread_id: "t1",
        subject: "Fair",
        from_header: "fair@example.com",
        to_header: "zone@example.com",
        internal_date_ms: 1,
        evidence_codes: [],
        candidate_organizations: [],
        has_attachments: false,
        review_state: "resolved",
        resolved_organization_id: "org-1",
        gmail_sync_state: "processing",
        gmail_sync_error_code: null,
        gmail_sync_mutation_id: "mutation-1",
      }];
    });
    const repository = new PostgresGoogleValidationRepository(pool);

    await expect(repository.listReviewItems()).resolves.toEqual([
      expect.objectContaining({ gmailSyncState: "pending" }),
    ]);
  });

  it("lists only approved mappings for one organization", async () => {
    const { pool } = poolWith((sql) => {
      if (sql.includes("SELECT id FROM google_workspace_connections")) {
        return [{ id: "connection-1" }];
      }
      if (sql.includes("FROM google_workspace_validation_mappings")) {
        return [
          {
            message_id: "m1",
            thread_id: "t1",
            organization_id: "org-1",
            contact_id: "contact-1",
            evidence_codes: ["exact_contact_email"],
          },
        ];
      }
      return [];
    });
    const repository = new PostgresGoogleValidationRepository(pool);

    await expect(repository.listApprovedForOrganization("org-1")).resolves.toEqual([
      {
        messageId: "m1",
        threadId: "t1",
        organizationId: "org-1",
        contactId: "contact-1",
        evidenceCodes: ["exact_contact_email"],
      },
    ]);
  });
});
