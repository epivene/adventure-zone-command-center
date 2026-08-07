import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { approvalClosureFromDurableRow, DrizzleActReviewCommandStore, DrizzleProductionOrganizerStore, manifestFromRows, manifestSourcesFromArchiveRows, projectActReviewDisplay } from "./review-sql-adapter";
import { ProductionActOrganizer, type ProductionOrganizerStore } from "./production-organizer";

describe("durable review adapter projections", () => {
  it("claims a completed run only through an explicit review-required outcome predicate", async () => {
    let whereClause: unknown;
    const database = {
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            whereClause = condition;
            return { returning: async () => [] };
          },
        }),
      }),
    } as never;

    await new DrizzleProductionOrganizerStore(database, { sourceDatabaseKey: "act-db" }).claim("run-complete");
    const rendered = new PgDialect().sqlToQuery(sql`${whereClause as never}`);
    expect(rendered.sql).toContain("exists");
    expect(rendered.params).toEqual(expect.arrayContaining([
      "complete", "awaiting_review", "unassigned", "unsupported",
    ]));
  });

  it("supersedes a production decision with a non-UUID owner identity", async () => {
    let supersededBy: unknown;
    const source = {
      id: "source-1", latestVersionId: "version-1", streamType: "company", actRecordId: "ACT-1",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "source-1", sourceVersionId: "version-1",
      scope: "duplicate_identity", decision: "keep_separate", requestKey: "decision-key",
      fieldName: null, targetEntityType: null, targetEntityId: null, active: false,
    };
    const database = {
      select: () => {
        const chain = {
          from: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          limit: async () => [{ source, version: null }],
        };
        return chain;
      },
      update: () => ({
        set: (values: { supersededBy?: unknown }) => {
          supersededBy = values.supersededBy;
          const chain = { where: () => chain, returning: async () => [decision] };
          return chain;
        },
      }),
    } as never;
    const applyService = {} as never;
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, applyService);

    await expect(store.supersedeDecision("source-1", "decision-1", "user_owner_123", "remove-key"))
      .resolves.toMatchObject({ id: "decision-1", active: false });
    expect(supersededBy).toBe("user_owner_123");
  });
  it("projects only explicitly allowed contact display fields", () => {
    expect(
      projectActReviewDisplay("contact", {
        FirstName: "Taako",
        LastName: "Taaco",
        Email: "taako@example.com",
        apiKey: "credential-one",
        credential: "credential-two",
        privateKey: "credential-three",
        customScalar: "private custom value",
      }),
    ).toEqual({
      FirstName: "Taako",
      LastName: "Taaco",
      Email: "taako@example.com",
    });
  });

  it("replays stable rejected operation IDs and count from the durable manifest", () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "safe:create",
          sourceRecordId: "safe",
          sourceVersionId: "v-safe",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
        {
          operationKey: "conflict:create",
          sourceRecordId: "conflict",
          sourceVersionId: "v-conflict",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "safe",
          sourceVersionId: "v-safe",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
        {
          sourceRecordId: "conflict",
          sourceVersionId: "v-conflict",
          state: "awaiting_review",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
      ],
    });
    const row = {
      selectedOperationIds: ["safe:create"],
      dependencyClosedOperationIds: ["safe:create"],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 1,
      manifestDigest: manifest.digest,
    };

    const first = approvalClosureFromDurableRow(manifest, row);
    const replay = approvalClosureFromDurableRow(manifest, row);

    expect(first).toMatchObject({
      rejectedOperationIds: ["conflict:create"],
      rejectedCount: 1,
    });
    expect(replay).toEqual(first);
  });

  it("reconstructs the canonical manifest digest from persisted rows", () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "organization:a",
          sourceRecordId: "a",
          sourceVersionId: "v1",
          targetType: "organization",
          action: "create",
          payload: { normalized: { kind: "organization", name: "A" } },
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "a",
          sourceVersionId: "v1",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: ["organization:a"],
        },
      ],
    });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.operations[0]?.payload).toEqual({
      normalized: { kind: "organization", name: "A" },
    });
    expect(manifest.outcomes[0]?.state).toBe("ready");
  });

  it("sorts persisted rows before hashing so SQL result order cannot change approvals", () => {
    const rows = {
      operations: [
        {
          operationKey: "z",
          sourceRecordId: "z",
          sourceVersionId: "vz",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
        {
          operationKey: "a",
          sourceRecordId: "a",
          sourceVersionId: "va",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "z",
          sourceVersionId: "vz",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: ["z"],
        },
        {
          sourceRecordId: "a",
          sourceVersionId: "va",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: ["a"],
        },
      ],
    };
    const reversed = manifestFromRows({
      operations: [...rows.operations].reverse(),
      outcomes: [...rows.outcomes].reverse(),
    });
    expect(manifestFromRows(rows).digest).toBe(reversed.digest);
  });

  it("keeps the organizer digest stable when execution updates outcome state", () => {
    const rows = {
      operations: [
        {
          operationKey: "organization:a",
          sourceRecordId: "a",
          sourceVersionId: "v1",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "a",
          sourceVersionId: "v1",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
      ],
    };
    const organized = manifestFromRows(rows);
    const executed = manifestFromRows(
      {
        ...rows,
        outcomes: [{ ...rows.outcomes[0]!, state: "applied" }],
      },
      organized.digest,
    );

    expect(executed.digest).toBe(organized.digest);
    expect(executed.outcomes[0]?.state).toBe("applied");
  });
  it("derives outcome operation keys from durable operation rows", () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "organization:a",
          sourceRecordId: "a",
          sourceVersionId: "v1",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "a",
          sourceVersionId: "v1",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
      ],
    });

    expect(manifest.outcomes[0]?.operationKeys).toEqual(["organization:a"]);
  });

  it("normalizes archived roots and applies exact relationships and active review evidence", () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1",
          sourceVersionId: "company-version-1",
          latestSourceVersionId: "company-version-1",
          streamType: "company",
          actRecordId: "company-act-1",
          rawSnapshot: { Name: "Adventure Zone" },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "contact-1",
          sourceVersionId: "contact-version-1",
          latestSourceVersionId: "contact-version-1",
          streamType: "contact",
          actRecordId: "contact-act-1",
          rawSnapshot: { FirstName: "Taako", LastName: "Taaco" },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "note-1",
          sourceVersionId: "note-version-1",
          latestSourceVersionId: "note-version-1",
          streamType: "note",
          actRecordId: "note-act-1",
          rawSnapshot: { Body: "Meet at the moon base." },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1",
          sourceVersionId: "relationship-version-1",
          latestSourceVersionId: "relationship-version-1",
          streamType: "company_contact",
          actRecordId: null,
          rawSnapshot: {},
          fetchedAt,
          relationshipEvidence: {
            source: "endpoint",
            parentKind: "contact",
            parentActRecordId: "contact-act-1",
            targetKind: "company",
            targetActRecordId: "company-act-1",
          },
        },
      ],
      assignments: [
        {
          sourceRecordId: "note-1",
          targetEntityType: "contact",
          targetEntityId: "contact-1",
          manualAuthority: true,
          active: true,
        },
      ],
      decisions: [
        {
          sourceRecordId: "contact-1",
          sourceVersionId: "contact-version-1",
          scope: "duplicate_identity",
          decision: "link_existing",
          targetEntityType: "contact",
          targetEntityId: "local-contact-1",
          active: true,
        },
        {
          sourceRecordId: "company-1",
          sourceVersionId: "company-version-1",
          scope: "field_conflict",
          decision: "use_source",
          targetEntityType: null,
          targetEntityId: null,
          active: true,
        },
      ],
    });

    expect(sources).toHaveLength(3);
    expect(sources.find((source) => source.sourceRecordId === "company-1")).toMatchObject({
      normalized: { kind: "organization", name: "Adventure Zone" },
      provenance: ["decision:use_source"],
    });
    expect(sources.find((source) => source.sourceRecordId === "contact-1")).toMatchObject({
      normalized: { kind: "contact", firstName: "Taako", lastName: "Taaco" },
      match: {
        kind: "exact",
        localId: "local-contact-1",
        reason: "manual_review",
      },
      relationships: { organizationSourceIds: ["company-1"] },
      provenance: ["decision:link_existing", "relationship_record:company:contact"],
    });
    expect(sources.find((source) => source.sourceRecordId === "note-1")).toMatchObject({
      normalized: { kind: "timeline", body: "Meet at the moon base." },
      relationships: { contactSourceIds: ["contact-1"] },
      provenance: ["manual_assignment"],
    });
  });

  it("fails closed before ready_to_apply when an observation is not the latest archived version", async () => {
    let persisted = false;
    let completed = false;
    const releasedCodes: string[] = [];
    const store: ProductionOrganizerStore = {
      async claim(runId) {
        return { runId, phase: "organizing", claimToken: "claim-stale" };
      },
      async loadSources() {
        return manifestSourcesFromArchiveRows({
          rows: [
            {
              sourceRecordId: "company-1",
              sourceVersionId: "company-version-old",
              latestSourceVersionId: "company-version-new",
              streamType: "company",
              actRecordId: "company-act-1",
              rawSnapshot: { Name: "Adventure Zone" },
              fetchedAt: new Date("2026-08-07T12:00:00.000Z"),
              relationshipEvidence: {},
            },
          ],
        });
      },
      async persistManifest() {
        persisted = true;
      },
      async complete() {
        completed = true;
      },
      async release(_runId, _claimToken, code) {
        releasedCodes.push(code);
      },
    };

    await expect(new ProductionActOrganizer(store).organize("run-stale")).rejects.toMatchObject({
      code: "stale_archived_source_version",
      status: 409,
    });
    expect(persisted).toBe(false);
    expect(completed).toBe(false);
    expect(releasedCodes).toEqual(["stale_archived_source_version"]);
  });

  it("holds incomplete archives, local duplicates, and unresolved relationships for review", async () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1", sourceVersionId: "company-version-1", latestSourceVersionId: "company-version-1", streamType: "company", actRecordId: "company-act-1", archiveCompleteness: "complete", rawSnapshot: { Name: "Adventure Zone" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "contact-1", sourceVersionId: "contact-version-1", latestSourceVersionId: "contact-version-1", streamType: "contact", actRecordId: "contact-act-1", archiveCompleteness: "complete", rawSnapshot: { FirstName: "Taako", LastName: "Taaco", EmailAddress: "same@example.com" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1", sourceVersionId: "relationship-version-1", latestSourceVersionId: "relationship-version-1", streamType: "company_contact", actRecordId: null, archiveCompleteness: "partial", rawSnapshot: {}, fetchedAt, relationshipEvidence: { source: "endpoint", parentKind: "contact", parentActRecordId: "contact-act-1", targetKind: "company", targetActRecordId: "company-act-1" },
        },
      ],
      localCandidates: {
        contacts: [
          { id: "local-1", firstName: "T", lastName: "One", email: "same@example.com" },
          { id: "local-2", firstName: "T", lastName: "Two", email: "same@example.com" },
        ],
      },
    });
    const result = await new ProductionActOrganizer({
      async claim(runId) { return { runId, phase: "organizing", claimToken: "claim" }; },
      async loadSources() { return sources; },
      async persistManifest() {},
      async complete() {},
      async release() {},
    }).organize("run-review-holds");

    expect(result.manifest.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRecordId: "company-1", state: "awaiting_review", issues: expect.arrayContaining([expect.objectContaining({ code: "archive_incomplete" })]) }),
      expect.objectContaining({ sourceRecordId: "contact-1", state: "awaiting_review", issues: expect.arrayContaining([expect.objectContaining({ code: "archive_incomplete" }), expect.objectContaining({ code: "ambiguous_match" })]) }),
    ]));
    expect(result.manifest.operations.some((operation) => ["company-1", "contact-1"].includes(operation.sourceRecordId))).toBe(false);
  });

  it("matches booking candidates only through an exact resolved local organization", async () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1", sourceVersionId: "company-v1", latestSourceVersionId: "company-v1", streamType: "company", actRecordId: "ACT-COMPANY", archiveCompleteness: "complete", rawSnapshot: { Name: "Adventure Zone" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "opportunity-1", sourceVersionId: "opportunity-v1", latestSourceVersionId: "opportunity-v1", streamType: "opportunity", actRecordId: "ACT-OPPORTUNITY", archiveCompleteness: "complete", rawSnapshot: { Name: "Summer Trip", City: "Denver", State: "CO", EstimatedCloseDate: "2026-08-12" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1", sourceVersionId: "relationship-v1", latestSourceVersionId: "relationship-v1", streamType: "company_opportunity", actRecordId: null, archiveCompleteness: "complete", rawSnapshot: {}, fetchedAt, relationshipEvidence: { source: "endpoint", parentKind: "company", parentActRecordId: "ACT-COMPANY", targetKind: "opportunity", targetActRecordId: "ACT-OPPORTUNITY" },
        },
      ],
      assignments: [
        { sourceRecordId: "company-1", targetEntityType: "organization", targetEntityId: "local-org", manualAuthority: true, active: true },
      ],
      localCandidates: {
        bookings: [
          { id: "booking-a", name: "Summer Trip", organizationId: "local-org", startsAt: "2026-08-12" },
          { id: "booking-b", name: "Summer Trip", organizationId: "local-org", startsAt: "2026-08-12" },
        ],
      },
    });

    const booking = sources.find((source) => source.sourceRecordId === "opportunity-1");
    expect(booking).toMatchObject({
      relationships: { organizationSourceIds: ["company-1"] },
      match: {
        kind: "ambiguous",
        candidateIds: ["booking-a", "booking-b"],
        reason: "multiple_compatible_booking_candidates",
      },
    });
    const manifest = await new ProductionActOrganizer({
      async claim(runId) { return { runId, phase: "organizing", claimToken: "claim" }; },
      async loadSources() { return sources; },
      async persistManifest() {},
      async complete() {},
      async release() {},
    }).organize("run-booking-review");
    expect(manifest.manifest.outcomes).toContainEqual(expect.objectContaining({ sourceRecordId: "opportunity-1", state: "awaiting_review" }));
    expect(manifest.manifest.operations.some((operation) => operation.sourceRecordId === "opportunity-1")).toBe(false);
  });
});
