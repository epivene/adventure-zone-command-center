import { describe, expect, it } from "vitest";

import {
  resolveActSourceGraph,
  type ActRelationshipEvidence,
  type ActSourceAssignmentEvidence,
} from "./relationship-resolver";

const edge = (input: Partial<ActRelationshipEvidence> & Pick<ActRelationshipEvidence, "parentStream" | "childStream">): ActRelationshipEvidence => ({
  parentSourceRecordId: null,
  parentActRecordId: null,
  childSourceRecordId: null,
  childActRecordId: null,
  evidenceKind: "relationship_record",
  ...input,
});

describe("Act relationship resolver", () => {
  it("resolves exact endpoint/inline identities independent of input order", () => {
    const input = {
      records: [
        { sourceRecordId: "co-1", streamType: "company", actRecordId: "C1" },
        { sourceRecordId: "ct-1", streamType: "contact", actRecordId: "P1" },
        { sourceRecordId: "op-1", streamType: "opportunity", actRecordId: "O1" },
        { sourceRecordId: "ac-1", streamType: "activity", actRecordId: "A1" },
      ],
      relationships: [
        edge({ parentStream: "company", childStream: "contact", parentActRecordId: "C1", childActRecordId: "P1", evidenceKind: "inline" }),
        edge({ parentStream: "opportunity", childStream: "company", parentActRecordId: "O1", childActRecordId: "C1" }),
        edge({ parentStream: "opportunity", childStream: "contact", parentActRecordId: "O1", childActRecordId: "P1" }),
      ],
    };
    const reversed = resolveActSourceGraph({ ...input, relationships: [...input.relationships].reverse() });
    expect(reversed.graph.companiesByContact).toEqual(new Map([["ct-1", new Set(["co-1"])] ]));
    expect(reversed.graph.companiesByOpportunity).toEqual(new Map([["op-1", new Set(["co-1"])] ]));
    expect(reversed.graph.contactsByOpportunity).toEqual(new Map([["op-1", new Set(["ct-1"])] ]));
    expect(reversed.graph.timelineParents).toEqual(new Map());
    expect(reversed.conflicts).toEqual([]);
  });

  it("keeps multiple exact organization parents for one contact", () => {
    const assignments: ActSourceAssignmentEvidence[] = [];
    const result = resolveActSourceGraph({
      records: [
        { sourceRecordId: "ct", streamType: "contact", actRecordId: "P" },
        { sourceRecordId: "a", streamType: "company", actRecordId: "A" },
        { sourceRecordId: "b", streamType: "company", actRecordId: "B" },
      ],
      assignments,
      relationships: [
        edge({ parentStream: "company", childStream: "contact", parentActRecordId: "A", childActRecordId: "P" }),
        edge({ parentStream: "company", childStream: "contact", parentActRecordId: "B", childActRecordId: "P" }),
      ],
    });
    expect(result.graph.companiesByContact.get("ct")).toEqual(new Set(["a", "b"]));
  });

  it("lets an active manual assignment win and reports conflicting source evidence", () => {
    const result = resolveActSourceGraph({
      records: [
        { sourceRecordId: "ct", streamType: "contact", actRecordId: "P" },
        { sourceRecordId: "a", streamType: "company", actRecordId: "A" },
        { sourceRecordId: "b", streamType: "company", actRecordId: "B" },
      ],
      assignments: [{ sourceRecordId: "ct", targetEntityType: "organization", targetEntityId: "a", manualAuthority: true, active: true }],
      relationships: [edge({ parentStream: "company", childStream: "contact", parentActRecordId: "B", childActRecordId: "P" })],
    });
    expect(result.graph.companiesByContact.get("ct")).toEqual(new Set(["a"]));
    expect(result.conflicts).toEqual([expect.objectContaining({ code: "manual_assignment_source_conflict", sourceRecordId: "ct" })]);
  });

  it("preserves unresolved and ambiguous evidence instead of guessing", () => {
    const result = resolveActSourceGraph({
      records: [{ sourceRecordId: "ac", streamType: "activity", actRecordId: "A" }],
      relationships: [edge({ parentStream: "activity", childStream: "company", parentActRecordId: "A", childActRecordId: "missing" })],
      matcherSuggestions: [{ sourceRecordId: "ac", targetType: "organization", candidateSourceRecordIds: ["x", "y"] }],
    });
    expect(result.graph.timelineParents.get("ac")).toBeUndefined();
    expect(result.unresolved).toEqual([expect.objectContaining({ code: "unresolved_exact_relationship" })]);
    expect(result.suggestions).toEqual([expect.objectContaining({ candidateSourceRecordIds: ["x", "y"] })]);
  });

  it("reports conflicting exact evidence for the same relationship slot", () => {
    const result = resolveActSourceGraph({
      records: [
        { sourceRecordId: "ct", streamType: "contact", actRecordId: "P" },
        { sourceRecordId: "a", streamType: "company", actRecordId: "A" },
        { sourceRecordId: "b", streamType: "company", actRecordId: "B" },
      ],
      relationships: [
        edge({ parentStream: "company", childStream: "contact", parentActRecordId: "A", childActRecordId: "P", relationshipSlot: "primary" }),
        edge({ parentStream: "company", childStream: "contact", parentActRecordId: "B", childActRecordId: "P", relationshipSlot: "primary" }),
      ],
    });
    expect(result.conflicts).toEqual([expect.objectContaining({ code: "source_relationship_conflict" })]);
  });

  it("attributes relationship-record identity conflicts to the affected root", () => {
    const result = resolveActSourceGraph({
      records: [
        { sourceRecordId: "ct", streamType: "contact", actRecordId: "P" },
        { sourceRecordId: "a", streamType: "company", actRecordId: "A" },
        { sourceRecordId: "b", streamType: "company", actRecordId: "B" },
      ],
      relationships: [
        edge({
          sourceRecordId: "relationship-row",
          parentStream: "company",
          childStream: "contact",
          parentSourceRecordId: "a",
          parentActRecordId: "B",
          childSourceRecordId: "ct",
          childActRecordId: "P",
        }),
      ],
    });

    expect(result.conflicts).toEqual([
      expect.objectContaining({
        code: "source_relationship_conflict",
        sourceRecordId: "ct",
      }),
    ]);
  });

  it("resolves activity associations across company, contact, and opportunity parents", () => {
    const result = resolveActSourceGraph({
      records: [
        { sourceRecordId: "ac", streamType: "activity", actRecordId: "A" },
        { sourceRecordId: "co", streamType: "company", actRecordId: "C" },
        { sourceRecordId: "ct", streamType: "contact", actRecordId: "P" },
        { sourceRecordId: "op", streamType: "opportunity", actRecordId: "O" },
      ],
      relationships: [
        edge({ parentStream: "activity", childStream: "company", parentActRecordId: "A", childActRecordId: "C" }),
        edge({ parentStream: "activity", childStream: "contact", parentActRecordId: "A", childActRecordId: "P" }),
        edge({ parentStream: "activity", childStream: "opportunity", parentActRecordId: "A", childActRecordId: "O" }),
      ],
    });
    expect(result.graph.timelineParents.get("ac")).toEqual({
      companyIds: new Set(["co"]), contactIds: new Set(["ct"]), opportunityIds: new Set(["op"]),
    });
  });
});
