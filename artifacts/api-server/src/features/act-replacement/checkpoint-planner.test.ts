import { describe, expect, it } from "vitest";

import { parseRootSourceRecords } from "./source-record-parser";
import {
  createPlainListFallbackCheckpoint,
  evaluatePaginationProgress,
  planRootDerivedCheckpoints,
} from "./checkpoint-planner";

describe("checkpoint planner", () => {
  it.each([
    "company",
    "contact",
    "opportunity",
    "group",
    "activity",
    "note",
    "history",
  ] as const)(
    "derives one initially required %s detail per unique ID",
    (streamType) => {
      const items = parseRootSourceRecords({
        streamType,
        records: [
          { id: `${streamType}/1` },
          { id: `${streamType}/1`, duplicate: true },
        ],
        queryMode: "projected",
      });

      const result = planRootDerivedCheckpoints({
        rootStream: streamType,
        items,
        pageSize: 100,
        queryMode: "projected",
        deriveDetails: true,
      });

      expect(
        result.filter(({ checkpointKind }) => checkpointKind === "detail"),
      ).toEqual([
        {
          streamType,
          checkpointKind: "detail",
          partitionKey: `detail:${encodeURIComponent(`${streamType}/1`)}`,
          requiredness: "required",
          parentSourceRecordId: null,
          parentActRecordId: `${streamType}/1`,
          sourceRecordId: null,
          nextSkip: 0,
          pageSize: 100,
          queryMode: "plain",
          deriveDetails: false,
        },
      ]);
    },
  );

  it.each([
    ["contact", ["company_contact"]],
    ["opportunity", ["opportunity_company", "opportunity_contact"]],
    ["group", ["group_contact"]],
  ] as const)(
    "derives the documented missing-inline relationship work for %s",
    (rootStream, relationshipStreams) => {
      const items = parseRootSourceRecords({
        streamType: rootStream,
        records: [{ id: `${rootStream}-1` }],
        queryMode: "projected",
      });

      const result = planRootDerivedCheckpoints({
        rootStream,
        items,
        pageSize: 50,
        queryMode: "projected",
        deriveDetails: true,
      });

      expect(
        result
          .filter(
            ({ checkpointKind, streamType }) =>
              checkpointKind === "relationship" && streamType !== "note",
          )
          .map(({ streamType }) => streamType),
      ).toEqual(relationshipStreams);
      expect(
        result.filter(
          ({ checkpointKind, streamType }) =>
            checkpointKind === "relationship" && streamType !== "note",
        ),
      ).toEqual(
        relationshipStreams.map((streamType) => ({
          streamType,
          checkpointKind: "relationship",
          partitionKey: `relationship:${encodeURIComponent(`${rootStream}-1`)}`,
          requiredness: "optional_capability",
          parentSourceRecordId: null,
          parentActRecordId: `${rootStream}-1`,
          sourceRecordId: null,
          nextSkip: 0,
          pageSize: 50,
          queryMode: "projected",
          deriveDetails: false,
        })),
      );
    },
  );

  it("derives required plain note extraction for every contact identity", () => {
    const items = parseRootSourceRecords({
      streamType: "contact",
      records: [{ id: "contact/1" }, { id: "contact/1", duplicate: true }],
      queryMode: "projected",
    });

    const result = planRootDerivedCheckpoints({
      rootStream: "contact",
      items,
      pageSize: 75,
      queryMode: "projected",
      deriveDetails: true,
    });

    expect(result.filter(({ streamType }) => streamType === "note")).toEqual([
      {
        streamType: "note",
        checkpointKind: "relationship",
        partitionKey: "contact-notes:contact%2F1",
        requiredness: "required",
        parentSourceRecordId: null,
        parentActRecordId: "contact/1",
        sourceRecordId: null,
        nextSkip: 0,
        pageSize: 75,
        queryMode: "plain",
        deriveDetails: false,
      },
    ]);
  });

  it.each(["activity", "note", "history"] as const)(
    "derives only absent %s relationship endpoint checkpoints",
    (rootStream) => {
      const items = parseRootSourceRecords({
        streamType: rootStream,
        records: [
          {
            id: `${rootStream}-1`,
            contact: { id: "contact-1" },
            companies: [],
          },
        ],
        queryMode: "projected",
      });

      const result = planRootDerivedCheckpoints({
        rootStream,
        items,
        pageSize: 200,
        queryMode: "projected",
        deriveDetails: true,
      });

      expect(
        result
          .filter(({ checkpointKind }) => checkpointKind === "relationship")
          .map(({ streamType }) => streamType),
      ).toEqual([`${rootStream}_opportunity`]);
    },
  );

  it("derives endpoint work when an inline field has no explicit target identity", () => {
    const items = parseRootSourceRecords({
      streamType: "contact",
      records: [{ id: "contact-1", company: "Name without an Act ID" }],
      queryMode: "projected",
    });

    expect(
      planRootDerivedCheckpoints({
        rootStream: "contact",
        items,
        pageSize: 100,
        queryMode: "projected",
        deriveDetails: true,
      })
        .filter(
          ({ checkpointKind, streamType }) =>
            checkpointKind === "relationship" && streamType !== "note",
        )
        .map(({ streamType }) => streamType),
    ).toEqual(["company_contact"]);
  });

  it("does not suppress endpoint work when only one of two inline forms is exact", () => {
    const items = parseRootSourceRecords({
      streamType: "contact",
      records: [
        {
          id: "contact-1",
          company: { id: "company-1" },
          companies: ["Company by name"],
        },
      ],
      queryMode: "projected",
    });

    expect(
      planRootDerivedCheckpoints({
        rootStream: "contact",
        items,
        pageSize: 100,
        queryMode: "projected",
        deriveDetails: true,
      })
        .filter(
          ({ checkpointKind, streamType }) =>
            checkpointKind === "relationship" && streamType !== "note",
        )
        .map(({ streamType }) => streamType),
    ).toEqual(["company_contact"]);
  });

  it("never derives details from a plain root or whole-stream fallback page", () => {
    const items = parseRootSourceRecords({
      streamType: "contact",
      records: [{ id: "contact-1" }],
      queryMode: "plain",
    });

    expect(
      planRootDerivedCheckpoints({
        rootStream: "contact",
        items,
        pageSize: 100,
        queryMode: "plain",
        deriveDetails: false,
      }).filter(({ checkpointKind }) => checkpointKind === "detail"),
    ).toEqual([]);
  });

  it.each([
    "company",
    "contact",
    "opportunity",
    "group",
    "activity",
    "note",
    "history",
  ] as const)(
    "creates the exact deterministic %s fallback spec",
    (rootStream) => {
      expect(
        createPlainListFallbackCheckpoint({ rootStream, pageSize: 100 }),
      ).toEqual({
        streamType: rootStream,
        checkpointKind: "plain_list_fallback",
        partitionKey: `plain-full:${rootStream}`,
        requiredness: "optional_capability",
        parentSourceRecordId: null,
        parentActRecordId: null,
        sourceRecordId: null,
        nextSkip: 0,
        pageSize: 100,
        queryMode: "plain",
        deriveDetails: false,
      });
    },
  );

  it.each([
    {
      name: "a fingerprint already present in any receipt",
      input: {
        currentSkip: 100,
        nextSkip: 200,
        pageFingerprint: "repeat",
        receiptFingerprints: ["older", "repeat"],
        pageSourceKeys: ["new"],
        seenSourceKeys: [],
        consecutiveNonemptyPagesWithoutNewKeys: 0,
      },
    },
    {
      name: "a non-increasing cursor",
      input: {
        currentSkip: 100,
        nextSkip: 100,
        pageFingerprint: "fresh",
        receiptFingerprints: [],
        pageSourceKeys: ["new"],
        seenSourceKeys: [],
        consecutiveNonemptyPagesWithoutNewKeys: 0,
      },
    },
    {
      name: "two nonempty pages with zero new source keys",
      input: {
        currentSkip: 100,
        nextSkip: 200,
        pageFingerprint: "fresh",
        receiptFingerprints: [],
        pageSourceKeys: ["seen"],
        seenSourceKeys: ["seen"],
        consecutiveNonemptyPagesWithoutNewKeys: 1,
      },
    },
  ])("stalls after $name", ({ input }) => {
    expect(
      evaluatePaginationProgress({
        ...input,
        checkpointKind: "list",
        requiredness: "required",
      }),
    ).toEqual({
      outcome: "pagination_stalled",
      errorCode: "pagination_stalled",
      nextConsecutiveNonemptyPagesWithoutNewKeys: expect.any(Number),
      limitation: null,
      affectedCompleteness: null,
    });
  });

  it.each(["relationship", "plain_list_fallback"] as const)(
    "records a named partial limitation when optional %s pagination stalls",
    (checkpointKind) => {
      expect(
        evaluatePaginationProgress({
          checkpointKind,
          requiredness: "optional_capability",
          currentSkip: 200,
          nextSkip: 200,
          pageFingerprint: "repeat",
          receiptFingerprints: ["repeat"],
          pageSourceKeys: ["source-1"],
          seenSourceKeys: ["source-1"],
          consecutiveNonemptyPagesWithoutNewKeys: 1,
        }),
      ).toEqual({
        outcome: "pagination_stalled",
        errorCode: "pagination_stalled",
        nextConsecutiveNonemptyPagesWithoutNewKeys: 2,
        limitation: `${checkpointKind}_pagination_stalled`,
        affectedCompleteness: "partial",
      });
    },
  );

  it("allows the first nonempty duplicate-only page and resets after progress", () => {
    const first = evaluatePaginationProgress({
      checkpointKind: "relationship",
      requiredness: "optional_capability",
      currentSkip: 0,
      nextSkip: 100,
      pageFingerprint: "page-1",
      receiptFingerprints: [],
      pageSourceKeys: ["seen"],
      seenSourceKeys: ["seen"],
      consecutiveNonemptyPagesWithoutNewKeys: 0,
    });
    const progressed = evaluatePaginationProgress({
      checkpointKind: "relationship",
      requiredness: "optional_capability",
      currentSkip: 100,
      nextSkip: 200,
      pageFingerprint: "page-2",
      receiptFingerprints: ["page-1"],
      pageSourceKeys: ["new"],
      seenSourceKeys: ["seen"],
      consecutiveNonemptyPagesWithoutNewKeys:
        first.nextConsecutiveNonemptyPagesWithoutNewKeys,
    });

    expect(first).toMatchObject({
      outcome: "continue",
      nextConsecutiveNonemptyPagesWithoutNewKeys: 1,
    });
    expect(progressed).toMatchObject({
      outcome: "continue",
      nextConsecutiveNonemptyPagesWithoutNewKeys: 0,
    });
  });
});
