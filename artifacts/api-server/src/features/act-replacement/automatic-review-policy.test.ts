import { describe, expect, it } from "vitest";
import type { ManifestOutcome } from "./manifest-builder";
import {
  automaticReviewProof,
  automaticReviewDisposition,
  hasProvenContextMatch,
  isAutomaticallyApprovedOperation,
  isAutomaticallyImportableOperation,
} from "./automatic-review-policy";

type Clue = {
  family: string;
  label: string;
  targetEntityType: string;
  targetEntityId: string;
  authority: "authoritative" | "supporting";
};

type PolicyOperation = {
  action: string;
  safeByDefault: boolean;
  status: string;
  targetType: string;
};

const clue = (
  family: string,
  targetEntityId = "organization-1",
  overrides: Partial<Clue> = {},
): Clue => ({
  family,
  label: `${family} agrees`,
  targetEntityType: "organization",
  targetEntityId,
  authority: "supporting",
  ...overrides,
});

const match = (overrides: Record<string, unknown> = {}) => ({
  kind: "exact",
  localId: "organization-1",
  evidence: [clue("identity", "organization-1", { authority: "authoritative" })],
  ...overrides,
});

const outcome = (
  value: unknown,
  state = "awaiting_review",
): { state: string; match: unknown } => ({ state, match: value });

const rootLink = (
  overrides: Partial<PolicyOperation> = {},
): PolicyOperation => ({
  action: "link_existing",
  safeByDefault: true,
  status: "pending",
  targetType: "organization",
  ...overrides,
});

const disposition = (
  value: unknown,
  operations: readonly PolicyOperation[] = [rootLink()],
) => automaticReviewDisposition({ outcome: outcome(value), operations });

describe("automatic review policy", () => {
  it("auto-resolves an exact match with one authoritative clue to the selected target", () => {
    expect(disposition(match())).toBe("auto_resolved");
  });

  it("auto-resolves an exact match with two distinct clue families to the selected target", () => {
    expect(disposition(match({
      evidence: [clue("identity"), clue("location")],
    }))).toBe("auto_resolved");
  });

  it("does not auto-resolve a single non-authoritative clue", () => {
    const value = match({
      evidence: [clue("identity", "organization-1", { authority: "supporting" })],
    });
    expect(hasProvenContextMatch({
      outcome: { match: value } satisfies Pick<ManifestOutcome, "match">,
      selectedTargetTypes: new Set(["organization"]),
    })).toBe(false);
    expect(disposition(value)).toBe("archived_only");
  });

  it("does not auto-resolve clues that point at different targets", () => {
    const value = match({ evidence: [clue("identity"), clue("location", "organization-2")] });
    expect(disposition(value)).toBe("archived_only");
  });

  it("fails closed when an authoritative clue is accompanied by another target", () => {
    const value = match({
      evidence: [
        clue("identity", "organization-1", { authority: "authoritative" }),
        clue("location", "organization-2"),
      ],
    });
    expect(disposition(value)).toBe("archived_only");
  });

  it("fails closed when an authoritative clue is accompanied by an incompatible entity type", () => {
    const value = match({
      evidence: [
        clue("identity", "organization-1", { authority: "authoritative" }),
        clue("location", "organization-1", { targetEntityType: "contact" }),
      ],
    });
    expect(disposition(value)).toBe("archived_only");
  });

  it("rejects evidence beyond the bounded array instead of hiding a contradiction", () => {
    const validEvidence = Array.from({ length: 20 }, () => clue("identity"));
    const value = match({
      evidence: [...validEvidence, clue("location", "organization-2")],
    });
    expect(disposition(value)).toBe("archived_only");
  });

  it("does not auto-resolve an ambiguous match", () => {
    expect(disposition({
      kind: "ambiguous",
      candidateIds: ["organization-1", "organization-2"],
      evidence: [clue("identity")],
    })).toBe("archived_only");
  });

  it("does not auto-resolve evidence for a different entity type than the selected link", () => {
    const value = match({
      evidence: [clue("identity", "organization-1", { targetEntityType: "contact" })],
    });
    expect(disposition(value)).toBe("archived_only");
  });

  it("counts repeated email and phone values from one clue family only once", () => {
    const value = match({
      evidence: [clue("direct_contact", "organization-1", { label: "email agrees" }), clue("direct_contact", "organization-1", { label: "phone agrees" })],
    });
    expect(disposition(value)).toBe("archived_only");
  });

  it("keeps a trusted exact external link safe without context evidence", () => {
    const value = match({ reason: "exact_external_link", evidence: undefined });

    expect(disposition(value)).toBe("safe_ready");
    expect(automaticReviewProof({
      outcome: outcome(value),
      operations: [rootLink()],
      operation: rootLink(),
    })).toEqual({
      version: 1,
      eligible: true,
      disposition: "safe_ready",
      basis: "trusted_exact_match",
    });
  });

  it("keeps a create safe when no context match is required", () => {
    const create = rootLink({ action: "create" });

    expect(automaticReviewProof({
      outcome: outcome({ kind: "none", reason: "no_candidate" }, "ready"),
      operations: [create],
      operation: create,
    })).toEqual({
      version: 1,
      eligible: true,
      disposition: "safe_ready",
      basis: "safe_create",
    });
  });

  it("proves only link and fill actions for strong context evidence", () => {
    const link = rootLink();
    const fill = rootLink({ action: "fill_missing" });
    const relationship = rootLink({
      action: "create_relationship",
      targetType: "organization_contact",
    });
    const value = match();

    expect(automaticReviewProof({
      outcome: outcome(value),
      operations: [link, fill, relationship],
      operation: link,
    })).toMatchObject({
      eligible: true,
      disposition: "auto_resolved",
      basis: "proven_context_match",
    });
    expect(automaticReviewProof({
      outcome: outcome(value),
      operations: [link, fill, relationship],
      operation: fill,
    })).toMatchObject({ eligible: true, disposition: "auto_resolved" });
    expect(automaticReviewProof({
      outcome: outcome(value),
      operations: [link, fill, relationship],
      operation: relationship,
    })).toMatchObject({ eligible: false, disposition: "auto_resolved" });
  });

  it("fails closed when persisted automatic proof is absent or malformed", () => {
    expect(isAutomaticallyApprovedOperation({
      ...rootLink(),
      payload: {},
    })).toBe(false);
    expect(isAutomaticallyApprovedOperation({
      ...rootLink(),
      payload: {
        automaticReview: {
          version: 1,
          eligible: true,
          disposition: "auto_resolved",
          basis: "made_up",
        },
      },
    })).toBe(false);
  });

  it("accepts only a bounded persisted proof for an importable operation", () => {
    const proof = automaticReviewProof({
      outcome: outcome(match()),
      operations: [rootLink()],
      operation: rootLink(),
    });

    expect(isAutomaticallyApprovedOperation({
      ...rootLink(),
      payload: {
        automaticReview: proof,
      },
    })).toBe(true);
    expect(isAutomaticallyApprovedOperation({
      ...rootLink(),
      payload: {
        automaticReview: {
          ...proof,
          evidence: Array.from({ length: 1_000 }, () => "unbounded"),
        },
      },
    })).toBe(false);
  });

  it("does not let a persisted proof authorize a generic target type", () => {
    expect(isAutomaticallyApprovedOperation({
      ...rootLink({ action: "create", targetType: "provenance" }),
      payload: {
        automaticReview: {
          version: 1,
          eligible: true,
          disposition: "safe_ready",
          basis: "safe_create",
        },
      },
    })).toBe(false);
  });

  it.each(["link_existing", "create", "fill_missing"])(
    "accepts a safe-by-default %s operation when pending",
    (action) => {
      expect(isAutomaticallyImportableOperation({ action, safeByDefault: true, status: "pending", targetType: "organization" })).toBe(true);
    },
  );

  it("accepts a failed safe operation for a new import attempt", () => {
    expect(isAutomaticallyImportableOperation({ action: "create", safeByDefault: true, status: "failed", targetType: "organization" })).toBe(true);
  });

  it.each([
    { action: "overwrite_reviewed", safeByDefault: true, status: "pending", targetType: "organization" },
    { action: "create", safeByDefault: false, status: "pending", targetType: "organization" },
    { action: "create", safeByDefault: true, status: "blocked", targetType: "organization" },
    { action: "create", safeByDefault: true, status: "leased", targetType: "organization" },
    { action: "create_relationship", safeByDefault: true, status: "pending", targetType: "organization_contact" },
    { action: "record_provenance", safeByDefault: true, status: "pending", targetType: "provenance" },
  ])("rejects a non-importable operation %#", (operation) => {
    expect(isAutomaticallyImportableOperation(operation)).toBe(false);
  });

  it("keeps relationship and provenance target types from proving an identity match", () => {
    const value = match({
      evidence: [clue("identity", "organization-1", { authority: "authoritative" })],
    });
    expect(disposition(value, [
      rootLink({ action: "create_relationship", targetType: "organization_contact" }),
      rootLink({ action: "record_provenance", targetType: "provenance" }),
    ])).toBe("archived_only");
  });

  it("marks an unresolved outcome with no importable operation archived-only", () => {
    expect(disposition({ kind: "none", reason: "no_candidate" }, [
      { action: "create_relationship", safeByDefault: true, status: "pending", targetType: "organization_contact" },
    ])).toBe("archived_only");
  });

  it("marks a failed outcome failed rather than archived-only", () => {
    expect(automaticReviewDisposition({
      outcome: outcome({ kind: "none", reason: "source_failed" }, "failed"),
      operations: [],
    })).toBe("failed");
  });
});
