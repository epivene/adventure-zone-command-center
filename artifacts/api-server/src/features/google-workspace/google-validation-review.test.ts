import { describe, expect, it, vi } from "vitest";

import { PostgresGoogleValidationRepository } from "./google-validation-repository";

function fakePool() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (text.includes("FROM organizations") && text.includes("consolidated_into_id IS NULL")) {
      return { rows: values?.[0] === "org-live" ? [{ id: "org-live" }] : [] };
    }
    if (text.includes("SELECT message_id") && text.includes("google_workspace_validation_review_items")) {
      return {
        rows: [{
          message_id: "m1",
          thread_id: "t1",
          subject: "County Fair application",
          from_header: "fair@example.org",
          to_header: "zone@example.com",
          internal_date_ms: "1787510000000",
          evidence_codes: ["exact_profile_name_text"],
          candidate_organizations: [{ id: "org-live", name: "County Fair" }],
          has_attachments: true,
          review_state: "pending",
          resolved_organization_id: null,
        }],
      };
    }
    if (text.includes("review_state = 'resolved'") && text.includes("RETURNING thread_id")) {
      return {
        rows: [{ thread_id: "t1", evidence_codes: ["exact_profile_name_text"] }],
      };
    }
    if (text.includes("review_state = 'ignored'") && text.includes("RETURNING message_id")) {
      return { rows: [{ message_id: "m1" }] };
    }
    return { rows: [] };
  });
  return { query, queries };
}

describe("Google validation review repository", () => {
  it("lists pending review metadata without bodies", async () => {
    const pool = fakePool();
    const repository = new PostgresGoogleValidationRepository(pool);

    await expect(repository.listReviewItems()).resolves.toEqual([
      {
        messageId: "m1",
        threadId: "t1",
        subject: "County Fair application",
        from: "fair@example.org",
        to: "zone@example.com",
        internalDateMs: 1787510000000,
        evidenceCodes: ["exact_profile_name_text"],
        candidates: [{ id: "org-live", name: "County Fair" }],
        hasAttachments: true,
        state: "pending",
        resolvedOrganizationId: null,
      },
    ]);
  });

  it("resolves a review item only to a live organization and creates the normal mapping", async () => {
    const pool = fakePool();
    const repository = new PostgresGoogleValidationRepository(pool);

    await repository.resolveReviewItem({
      messageId: "m1",
      organizationId: "org-live",
      actorId: "owner-1",
      now: new Date("2026-08-24T18:00:00.000Z"),
    });

    expect(pool.queries.some(({ text }) => text.includes("INSERT INTO google_workspace_validation_mappings"))).toBe(true);
    expect(pool.queries.some(({ text }) => text.includes("review_state = 'resolved'"))).toBe(true);
    expect(pool.queries.some(({ text }) => text.includes("validation_review_resolved"))).toBe(true);
  });

  it("rejects a stale or retired target organization", async () => {
    const pool = fakePool();
    const repository = new PostgresGoogleValidationRepository(pool);

    await expect(repository.resolveReviewItem({
      messageId: "m1",
      organizationId: "org-retired",
      actorId: "owner-1",
      now: new Date(),
    })).rejects.toThrow("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");
  });

  it("can explicitly ignore an item without creating a mapping", async () => {
    const pool = fakePool();
    const repository = new PostgresGoogleValidationRepository(pool);

    await repository.ignoreReviewItem({
      messageId: "m1",
      actorId: "owner-1",
      now: new Date("2026-08-24T18:00:00.000Z"),
    });

    expect(pool.queries.some(({ text }) => text.includes("review_state = 'ignored'"))).toBe(true);
    expect(pool.queries.some(({ text }) => text.includes("validation_review_ignored"))).toBe(true);
    expect(pool.queries.some(({ text }) => text.includes("INSERT INTO google_workspace_validation_mappings"))).toBe(false);
  });
});
