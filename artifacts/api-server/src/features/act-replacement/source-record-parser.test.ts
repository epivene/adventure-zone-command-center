import { describe, expect, it } from "vitest";

import {
  parseDetailSourceRecord,
  parseInlineRelationshipRecords,
  parseRelationshipSourceRecords,
  parseRootSourceRecords,
  reconcilePlainFallbackCoverage,
} from "./source-record-parser";

describe("source record parser", () => {
  it.each([
    "company",
    "contact",
    "opportunity",
    "group",
    "activity",
    "note",
    "history",
  ] as const)(
    "preserves projected %s rows as discovered records",
    (streamType) => {
      const raw = {
        id: `${streamType}-1`,
        custom: { nested: ["retained", { value: 7 }] },
        createDate: "2026-07-01T10:00:00.000Z",
        edited: "2026-07-02T11:00:00.000Z",
      };

      expect(
        parseRootSourceRecords({
          streamType,
          records: [raw],
          queryMode: "projected",
        }),
      ).toEqual([
        {
          streamType,
          sourceKey: `${streamType}-1`,
          actRecordId: `${streamType}-1`,
          snapshotScope: "list_projected",
          archiveCompleteness: "discovered",
          raw,
          relationshipEvidence: {},
          sourceCreatedAt: new Date("2026-07-01T10:00:00.000Z"),
          sourceEditedAt: new Date("2026-07-02T11:00:00.000Z"),
        },
      ]);
    },
  );

  it("preserves duplicate IDs and gives ID-less rows deterministic content keys", () => {
    const idless = { name: "No id", custom: { order: [2, 1] } };
    const records = [
      { id: "duplicate", value: "first" },
      { id: "duplicate", value: "second" },
      idless,
      { custom: { order: [2, 1] }, name: "No id" },
    ];

    const first = parseRootSourceRecords({
      streamType: "contact",
      records,
      queryMode: "plain",
    });
    const second = parseRootSourceRecords({
      streamType: "contact",
      records: [idless],
      queryMode: "plain",
    });

    expect(first.map(({ sourceKey }) => sourceKey)).toEqual([
      "duplicate",
      "duplicate",
      expect.stringMatching(/^fallback:[a-f0-9]{64}$/),
      first[2]?.sourceKey,
    ]);
    expect(second[0]?.sourceKey).toBe(first[2]?.sourceKey);
    expect(first.map(({ raw }) => raw)).toEqual(records);
    expect(
      first.every(({ snapshotScope }) => snapshotScope === "list_plain"),
    ).toBe(true);
    expect(
      first.every(
        ({ archiveCompleteness }) => archiveCompleteness === "complete",
      ),
    ).toBe(true);
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
    "archives %s detail as complete without dropping fields",
    (streamType) => {
      const raw = { id: `${streamType}-1`, onlyInDetail: { retained: true } };

      expect(
        parseDetailSourceRecord({
          streamType,
          requestedId: `${streamType}-1`,
          record: raw,
        }),
      ).toMatchObject({
        streamType,
        sourceKey: `${streamType}-1`,
        actRecordId: `${streamType}-1`,
        snapshotScope: "detail",
        archiveCompleteness: "complete",
        raw,
      });
    },
  );

  it("keeps the requested detail identity when a malformed body reports another ID", () => {
    expect(
      parseDetailSourceRecord({
        streamType: "contact",
        requestedId: "requested-contact",
        record: { id: "unexpected-contact", retained: true },
      }),
    ).toMatchObject({
      sourceKey: "requested-contact",
      actRecordId: "requested-contact",
      raw: { id: "unexpected-contact", retained: true },
      relationshipEvidence: {
        requestedActRecordId: "requested-contact",
        returnedActRecordId: "unexpected-contact",
      },
    });
  });

  it.each([
    ["company_contact", "contact", "contact-1", "company", "company-1"],
    ["opportunity_company", "opportunity", "opp-1", "company", "company-1"],
    ["opportunity_contact", "opportunity", "opp-1", "contact", "contact-1"],
    ["group_contact", "group", "group-1", "contact", "contact-1"],
    ["activity_contact", "activity", "activity-1", "contact", "contact-1"],
    ["activity_company", "activity", "activity-1", "company", "company-1"],
    ["activity_opportunity", "activity", "activity-1", "opportunity", "opp-1"],
    ["note_contact", "note", "note-1", "contact", "contact-1"],
    ["note_company", "note", "note-1", "company", "company-1"],
    ["note_opportunity", "note", "note-1", "opportunity", "opp-1"],
    ["history_contact", "history", "history-1", "contact", "contact-1"],
    ["history_company", "history", "history-1", "company", "company-1"],
    ["history_opportunity", "history", "history-1", "opportunity", "opp-1"],
  ] as const)(
    "archives explicit %s endpoint identities",
    (streamType, parentKind, parentId, targetKind, targetId) => {
      const related = { id: targetId, arbitrary: { retained: true } };

      expect(
        parseRelationshipSourceRecords({
          streamType,
          parentKind,
          parentId,
          targetKind,
          records: [related],
        }),
      ).toEqual([
        expect.objectContaining({
          streamType,
          sourceKey: `${encodeURIComponent(parentId)}:${encodeURIComponent(targetId)}`,
          actRecordId: null,
          snapshotScope: "relationship",
          archiveCompleteness: "complete",
          raw: related,
          relationshipEvidence: {
            source: "endpoint",
            parentKind,
            parentActRecordId: parentId,
            targetKind,
            targetActRecordId: targetId,
          },
        }),
      ]);
    },
  );

  it("extracts both singular and plural inline relationship evidence", () => {
    const note = {
      id: "note/1",
      contact: { id: "contact/1", fullName: "Singular" },
      companies: [
        { id: "company/1", name: "Plural one" },
        { id: "company/2", name: "Plural two" },
      ],
      opportunity: null,
    };

    const parsed = parseInlineRelationshipRecords({
      parentKind: "note",
      parentRecord: note,
    });

    expect(parsed.coveredTargets).toEqual([
      "contact",
      "company",
      "opportunity",
    ]);
    expect(parsed.missingTargets).toEqual([]);
    expect(
      parsed.items.map(({ streamType, sourceKey, relationshipEvidence }) => ({
        streamType,
        sourceKey,
        relationshipEvidence,
      })),
    ).toEqual([
      {
        streamType: "note_contact",
        sourceKey: "note%2F1:contact%2F1",
        relationshipEvidence: expect.objectContaining({ source: "inline" }),
      },
      {
        streamType: "note_company",
        sourceKey: "note%2F1:company%2F1",
        relationshipEvidence: expect.objectContaining({ source: "inline" }),
      },
      {
        streamType: "note_company",
        sourceKey: "note%2F1:company%2F2",
        relationshipEvidence: expect.objectContaining({ source: "inline" }),
      },
    ]);
  });

  it.each([
    {
      parentKind: "contact",
      parentRecord: {
        id: "contact-1",
        company: { id: "company-singular" },
        companies: [{ id: "company-plural" }],
      },
      expected: [
        ["company_contact", "contact-1:company-singular", "company"],
        ["company_contact", "contact-1:company-plural", "company"],
      ],
    },
    {
      parentKind: "opportunity",
      parentRecord: {
        id: "opportunity-1",
        company: { id: "company-singular" },
        companies: [{ id: "company-plural" }],
        contact: { id: "contact-singular" },
        contacts: [{ id: "contact-plural" }],
      },
      expected: [
        ["opportunity_company", "opportunity-1:company-singular", "company"],
        ["opportunity_company", "opportunity-1:company-plural", "company"],
        ["opportunity_contact", "opportunity-1:contact-singular", "contact"],
        ["opportunity_contact", "opportunity-1:contact-plural", "contact"],
      ],
    },
    {
      parentKind: "group",
      parentRecord: {
        id: "group-1",
        contact: { id: "contact-singular" },
        contacts: [{ id: "contact-plural" }],
      },
      expected: [
        ["group_contact", "group-1:contact-singular", "contact"],
        ["group_contact", "group-1:contact-plural", "contact"],
      ],
    },
  ] as const)(
    "archives singular and plural inline relationships in the $parentKind endpoint direction",
    ({ parentKind, parentRecord, expected }) => {
      const parsed = parseInlineRelationshipRecords({
        parentKind,
        parentRecord,
      });

      expect(
        parsed.items.map(({ streamType, sourceKey, relationshipEvidence }) => [
          streamType,
          sourceKey,
          relationshipEvidence.targetKind,
        ]),
      ).toEqual(expected);
      expect(
        parsed.items.map(
          ({ relationshipEvidence }) => relationshipEvidence.parentKind,
        ),
      ).toEqual(expected.map(() => parentKind));
      expect(parsed.missingTargets).toEqual([]);
    },
  );

  it.each([
    ["contact", { id: "contact-1", company: null, companies: [] }],
    [
      "opportunity",
      {
        id: "opportunity-1",
        company: null,
        companies: [],
        contact: null,
        contacts: [],
      },
    ],
    ["group", { id: "group-1", contact: null, contacts: [] }],
  ] as const)(
    "treats explicit null and empty %s relationships as covered without inventing items",
    (parentKind, parentRecord) => {
      const parsed = parseInlineRelationshipRecords({
        parentKind,
        parentRecord,
      });

      expect(parsed.items).toEqual([]);
      expect(parsed.missingTargets).toEqual([]);
    },
  );

  it.each([
    ["contact", { id: "contact-1", company: "Company by name" }, ["company"]],
    [
      "opportunity",
      {
        id: "opportunity-1",
        company: "Company by name",
        contacts: ["Contact by name"],
      },
      ["company", "contact"],
    ],
    ["group", { id: "group-1", contact: "Contact by name" }, ["contact"]],
  ] as const)(
    "leaves malformed or name-only %s relationships for endpoint coverage",
    (parentKind, parentRecord, missingTargets) => {
      const parsed = parseInlineRelationshipRecords({
        parentKind,
        parentRecord,
      });

      expect(parsed.items).toEqual([]);
      expect(parsed.missingTargets).toEqual(missingTargets);
    },
  );

  it("keeps endpoint coverage pending when one inline form is exact but the other is malformed", () => {
    const parsed = parseInlineRelationshipRecords({
      parentKind: "contact",
      parentRecord: {
        id: "contact-1",
        company: { id: "company-1" },
        companies: ["Company by name"],
      },
    });

    expect(parsed.items.map(({ sourceKey }) => sourceKey)).toEqual([
      "contact-1:company-1",
    ]);
    expect(parsed.missingTargets).toEqual(["company"]);
  });

  it("uses fallback source keys for an ID-less inline parent and target without inventing Act IDs", () => {
    const parentRecord = {
      subject: "ID-less note",
      contact: { customFields: { source: "ID-less contact" } },
    };

    const parsed = parseInlineRelationshipRecords({
      parentKind: "note",
      parentRecord,
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]).toMatchObject({
      streamType: "note_contact",
      sourceKey: expect.stringMatching(
        /^fallback%3A[a-f0-9]{64}:fallback%3A[a-f0-9]{64}$/,
      ),
      relationshipEvidence: {
        source: "inline",
        parentKind: "note",
        parentActRecordId: null,
        targetKind: "contact",
        targetActRecordId: null,
      },
    });
    expect(parsed.missingTargets).toContain("contact");
  });

  it("marks projected identities omitted by a complete plain fallback as partial", () => {
    const projected = parseRootSourceRecords({
      streamType: "contact",
      records: [
        { id: "returned", projected: true },
        { id: "omitted", projected: true },
      ],
      queryMode: "projected",
    });
    const fallback = parseRootSourceRecords({
      streamType: "contact",
      records: [{ id: "returned", complete: true }],
      queryMode: "plain",
    });

    const result = reconcilePlainFallbackCoverage({ projected, fallback });

    expect(result.complete.map(({ sourceKey }) => sourceKey)).toEqual([
      "returned",
    ]);
    expect(result.partial).toEqual([
      expect.objectContaining({
        sourceKey: "omitted",
        archiveCompleteness: "partial",
        relationshipEvidence: {
          limitations: ["plain_fallback_omitted_identity"],
        },
      }),
    ]);
    expect(result.derivedCheckpoints).toEqual([]);
  });

  it("retains projected relationship evidence when fallback rows upgrade identity completeness", () => {
    const [projected] = parseRootSourceRecords({
      streamType: "contact",
      records: [{ id: "contact-1", company: { id: "company-1" } }],
      queryMode: "projected",
    });
    const [fallback] = parseRootSourceRecords({
      streamType: "contact",
      records: [{ id: "contact-1", allFields: true }],
      queryMode: "plain",
    });
    if (!projected || !fallback) throw new Error("fixture setup failed");
    projected.relationshipEvidence = {
      companyIds: ["company-1"],
      source: "inline",
    };

    expect(
      reconcilePlainFallbackCoverage({
        projected: [projected],
        fallback: [fallback],
      }).complete,
    ).toEqual([
      expect.objectContaining({
        sourceKey: "contact-1",
        archiveCompleteness: "complete",
        raw: { id: "contact-1", allFields: true },
        relationshipEvidence: {
          companyIds: ["company-1"],
          source: "inline",
        },
      }),
    ]);
  });
});
