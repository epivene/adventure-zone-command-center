import { describe, expect, it } from "vitest";

import { parseSourceItem } from "@/features/act-migration/source-parser";

describe("parseSourceItem", () => {
  it("normalizes Company matching fields while preserving its raw snapshot", () => {
    const raw = {
      id: " COMPANY-1 ",
      name: "  Example   Events  ",
      phone: " (303) 555-0100 ",
      website: " HTTPS://Example.COM ",
      industry: "  Fair / Festival  ",
      edited: " 2026-07-29T10:00:00Z ",
      address: {
        line1: " 100 Main St ",
        line2: " Suite 4 ",
        city: "  Denver ",
        state: " CO ",
        postalCode: " 80202 ",
      },
    };

    const parsed = parseSourceItem("company", raw);

    expect(parsed).toMatchObject({
      ok: true,
      sourceId: "COMPANY-1",
      sourceKey: "company:COMPANY-1",
      normalized: {
        displayName: "Example Events",
        normalizedName: "example events",
        phone: "(303) 555-0100",
        normalizedPhone: "3035550100",
        website: "HTTPS://Example.COM",
        industry: "Fair / Festival",
        address1: "100 Main St",
        address2: "Suite 4",
        city: "Denver",
        region: "CO",
        postalCode: "80202",
        normalizedCity: "denver",
        normalizedRegion: "co",
        editedAt: "2026-07-29T10:00:00Z",
      },
    });
    expect(parsed.rawSnapshot).toBe(raw);
  });

  it.each(["INFO", "Sales", "office"])(
    "normalizes Contact values and classifies the %s mailbox as shared",
    (mailbox) => {
      const raw = {
        id: " CONTACT-1 ",
        firstName: " Avery ",
        lastName: " Example ",
        fullName: "  Avery   Example ",
        company: " Example Events ",
        jobTitle: " Director ",
        emailAddress: ` ${mailbox}@EXAMPLE.COM `,
        businessPhone: "(303) 555-0123",
        edited: " 2026-07-29T11:00:00Z ",
        businessAddress: {
          line1: " 200 Market St ",
          line2: " Floor 2 ",
          city: " Denver ",
          state: " CO ",
          postalCode: " 80203 ",
        },
      };

      const parsed = parseSourceItem("contact", raw);

      expect(parsed).toMatchObject({
        ok: true,
        sourceId: "CONTACT-1",
        normalized: {
          firstName: "Avery",
          lastName: "Example",
          displayName: "Avery Example",
          normalizedName: "avery example",
          companyName: "Example Events",
          normalizedCompanyName: "example events",
          jobTitle: "Director",
          email: `${mailbox.toLowerCase()}@example.com`,
          phone: "(303) 555-0123",
          normalizedPhone: "3035550123",
          address1: "200 Market St",
          address2: "Floor 2",
          city: "Denver",
          region: "CO",
          postalCode: "80203",
          normalizedCity: "denver",
          normalizedRegion: "co",
          sharedEmail: true,
          personCandidate: true,
          editedAt: "2026-07-29T11:00:00Z",
        },
      });
      expect(parsed.rawSnapshot).toBe(raw);
    },
  );

  it("does not propose a Person for a company-only Contact", () => {
    const parsed = parseSourceItem("contact", {
      id: "CONTACT-COMPANY",
      firstName: " ",
      lastName: "",
      fullName: "",
      company: " Example Fair Association ",
      emailAddress: "events@example.com",
    });

    expect(parsed).toMatchObject({
      ok: true,
      normalized: {
        displayName: null,
        normalizedName: null,
        companyName: "Example Fair Association",
        personCandidate: false,
      },
    });
  });

  it("preserves exact Opportunity status and nested stage metadata", () => {
    const raw = {
      id: " OPPORTUNITY-1 ",
      name: "  County   Fair  ",
      status: "  Open - Qualified  ",
      estimatedCloseDate: " 2026-09-01 ",
      actualCloseDate: " 2026-09-03 ",
      total: 12500,
      probability: 65,
      edited: " 2026-07-29T12:00:00Z ",
      stage: {
        id: " STAGE-7 ",
        name: "  Proposal / Review  ",
        process: {
          id: " PROCESS-2 ",
          name: "  Event Sales Pipeline  ",
        },
      },
    };

    const parsed = parseSourceItem("opportunity", raw);

    expect(parsed).toMatchObject({
      ok: true,
      sourceId: "OPPORTUNITY-1",
      normalized: {
        displayName: "County Fair",
        normalizedName: "county fair",
        status: "Open - Qualified",
        estimatedCloseDate: "2026-09-01",
        actualCloseDate: "2026-09-03",
        total: 12500,
        probability: 65,
        stageId: "STAGE-7",
        stageName: "Proposal / Review",
        processId: "PROCESS-2",
        processName: "Event Sales Pipeline",
        editedAt: "2026-07-29T12:00:00Z",
      },
    });
    expect(parsed.rawSnapshot).toBe(raw);
  });

  it("preserves Group metadata and numeric-looking API strings", () => {
    const raw = {
      id: " GROUP-1 ",
      name: " 12345 ",
      description: " 999999 ",
      edited: " 2026-07-29T13:00:00Z ",
    };

    const parsed = parseSourceItem("group", raw);

    expect(parsed).toMatchObject({
      ok: true,
      sourceId: "GROUP-1",
      normalized: {
        displayName: "12345",
        normalizedName: "12345",
        description: "999999",
        editedAt: "2026-07-29T13:00:00Z",
      },
    });
    expect(parsed.rawSnapshot).toBe(raw);
  });

  it.each([
    ["company_contact", "Z-COMPANY", "A-CONTACT"],
    ["opportunity_company", "Z-OPPORTUNITY", "A-COMPANY"],
    ["opportunity_contact", "Z-OPPORTUNITY", "A-CONTACT"],
    ["group_contact", "Z-GROUP", "A-CONTACT"],
  ] as const)(
    "keeps %s relationship IDs in semantic source-to-target order",
    (streamType, sourceId, targetSourceId) => {
      const parsed = parseSourceItem(streamType, {
        sourceId: ` ${sourceId} `,
        targetSourceId: ` ${targetSourceId} `,
      });

      expect(parsed).toMatchObject({
        ok: true,
        sourceId,
        sourceKey: `${streamType}:${sourceId}:${targetSourceId}`,
        normalized: { sourceId, targetSourceId },
      });
    },
  );

  it("returns deterministic sanitized metadata when a stable ID is missing", () => {
    const raw = {
      id: " ",
      fullName: "Private Person Name",
      emailAddress: "private@example.com",
    };

    const first = parseSourceItem("contact", raw);
    const second = parseSourceItem("contact", {
      emailAddress: "private@example.com",
      fullName: "Private Person Name",
      id: " ",
    });

    expect(first).toMatchObject({
      ok: false,
      errorCode: "missing_source_id",
      errorFields: ["id"],
    });
    expect(second).toMatchObject({
      ok: false,
      deterministicErrorKey: first.ok
        ? "unexpected-success"
        : first.deterministicErrorKey,
    });
    expect(first.rawSnapshot).toBe(raw);
    if (!first.ok) {
      expect(first.deterministicErrorKey).toMatch(
        /^error:contact:[a-f0-9]{64}$/,
      );
      expect(
        JSON.stringify({
          deterministicErrorKey: first.deterministicErrorKey,
          errorCode: first.errorCode,
          errorFields: first.errorFields,
        }),
      ).not.toContain("Private Person Name");
      expect(first.errorFields).not.toContain("private@example.com");
    }
  });

  it("recursively canonicalizes object keys only for fingerprints", () => {
    const firstRaw = {
      id: "GROUP-CANONICAL",
      metadata: {
        z: 1,
        nested: { b: true, a: false },
        list: [{ y: 2, x: 1 }, "keep-order"],
      },
    };
    const reorderedRaw = {
      metadata: {
        list: [{ x: 1, y: 2 }, "keep-order"],
        nested: { a: false, b: true },
        z: 1,
      },
      id: "GROUP-CANONICAL",
    };
    const reorderedArrayRaw = {
      id: "GROUP-CANONICAL",
      metadata: {
        z: 1,
        nested: { b: true, a: false },
        list: ["keep-order", { y: 2, x: 1 }],
      },
    };

    const first = parseSourceItem("group", firstRaw);
    const reordered = parseSourceItem("group", reorderedRaw);
    const reorderedArray = parseSourceItem("group", reorderedArrayRaw);

    expect(first.ok).toBe(true);
    expect(reordered.ok).toBe(true);
    expect(reorderedArray.ok).toBe(true);
    if (first.ok && reordered.ok && reorderedArray.ok) {
      expect(first.fingerprint).toBe(reordered.fingerprint);
      expect(first.fingerprint).not.toBe(reorderedArray.fingerprint);
      expect(first.rawSnapshot).toBe(firstRaw);
      expect(Object.keys(first.rawSnapshot)).toEqual(["id", "metadata"]);
      expect(Object.keys(reordered.rawSnapshot)).toEqual(["metadata", "id"]);
    }
  });
});
