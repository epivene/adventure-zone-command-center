import { describe, expect, it } from "vitest";

import { HttpActMigrationSourceClient } from "@/features/act-migration/source-client";
import type { ActReadTransport } from "@/features/act-replacement/act-read-transport";
import { ActApiError } from "@/features/act-sync/act-errors";

type ReadRequest = Parameters<ActReadTransport["getJson"]>[0];

function recordingReadTransport(
  response: unknown | ((request: ReadRequest) => unknown),
) {
  const requests: ReadRequest[] = [];
  const transport: ActReadTransport = {
    async getJson(request) {
      requests.push(request);
      return typeof response === "function" ? response(request) : response;
    },
    rateLimit: { limit: null, remaining: null, reset: null },
  };
  return { transport, requests };
}

const projected = { skip: 0, top: 100, queryMode: "projected" } as const;
const plain = { skip: 0, top: 100, queryMode: "plain" } as const;

describe("HttpActMigrationSourceClient queries", () => {
  it("sends projection, expansion, ordering, and pagination in projected mode", async () => {
    const { transport, requests } = recordingReadTransport([
      { id: "contact-1" },
    ]);

    await new HttpActMigrationSourceClient(transport).listContacts(projected);

    expect(requests).toEqual([
      {
        path: "/api/contacts",
        query: {
          $select:
            "id,firstName,lastName,fullName,company,jobTitle,emailAddress,businessPhone,edited",
          $expand: "businessAddress($select=line1,line2,city,state,postalCode)",
          $orderby: "id",
          $skip: "0",
          $top: "100",
        },
      },
    ]);
  });

  it("sends no advanced options in plain mode", async () => {
    const { transport, requests } = recordingReadTransport([
      { id: "contact-1" },
    ]);

    await new HttpActMigrationSourceClient(transport).listContacts({
      ...plain,
      filter: "edited gt 2026-08-01T00:00:00Z",
    });

    expect(requests).toEqual([
      {
        path: "/api/contacts",
        query: { $skip: "0", $top: "100" },
      },
    ]);
  });
});

describe("HttpActMigrationSourceClient response shapes", () => {
  it.each([
    {
      name: "a wrapped response",
      response: { value: [{ id: "wrapped" }] },
      id: "wrapped",
    },
    {
      name: "a top-level response",
      response: [{ id: "top-level" }],
      id: "top-level",
    },
  ])("reads $name", async ({ response, id }) => {
    const { transport } = recordingReadTransport(response);

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes(plain),
    ).resolves.toEqual({
      items: [{ id }],
      nextSkip: 1,
      queryMode: "plain",
    });
  });

  it("rejects an unsupported response shape safely", async () => {
    const { transport } = recordingReadTransport({ items: [{ id: "wrong" }] });

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes(plain),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("HttpActMigrationSourceClient replacement stream coverage", () => {
  it.each([
    ["company", "/api/companies"],
    ["contact", "/api/contacts"],
    ["opportunity", "/api/opportunities"],
    ["group", "/api/groups"],
    ["activity", "/api/activities"],
    ["note", "/api/notes"],
    ["history", "/api/history"],
  ] as const)("reads the complete %s root stream", async (kind, path) => {
    const { transport, requests } = recordingReadTransport([{ id: kind }]);
    const client = new HttpActMigrationSourceClient(transport);

    await expect(client.listRoot(kind, plain)).resolves.toMatchObject({
      items: [{ id: kind }],
      queryMode: "plain",
    });

    expect(requests).toEqual([{ path, query: { $skip: "0", $top: "100" } }]);
  });

  it.each([
    ["company", "/api/companies"],
    ["contact", "/api/contacts"],
    ["opportunity", "/api/opportunities"],
    ["group", "/api/groups"],
    ["activity", "/api/activities"],
    ["note", "/api/notes"],
    ["history", "/api/history"],
  ] as const)(
    "reads the %s detail path with an escaped ID",
    async (kind, root) => {
      const { transport, requests } = recordingReadTransport({
        value: { id: "detail-1", customField: "kept" },
      });
      const client = new HttpActMigrationSourceClient(transport);

      await expect(client.getDetail(kind, "id/with ?#")).resolves.toEqual({
        id: "detail-1",
        customField: "kept",
      });
      expect(requests).toEqual([{ path: `${root}/id%2Fwith%20%3F%23` }]);
    },
  );

  it("does not confuse a top-level detail value field with a wrapper", async () => {
    const detail = { id: "contact-1", value: "custom field", retained: true };
    const { transport } = recordingReadTransport(detail);

    await expect(
      new HttpActMigrationSourceClient(transport).getDetail(
        "contact",
        "contact-1",
      ),
    ).resolves.toEqual(detail);
  });

  it("preserves an ID-less top-level detail with an object value and sibling fields", async () => {
    const detail = {
      value: { nestedCustomField: true },
      siblingCustomField: "retained",
    };
    const { transport } = recordingReadTransport(detail);

    await expect(
      new HttpActMigrationSourceClient(transport).getDetail(
        "contact",
        "requested-contact",
      ),
    ).resolves.toEqual(detail);
  });

  it.each([
    [
      "company_contact",
      "contact",
      "company",
      "/api/contacts/parent%2F1/companies",
    ],
    [
      "opportunity_company",
      "opportunity",
      "company",
      "/api/opportunities/parent%2F1/companies",
    ],
    [
      "opportunity_contact",
      "opportunity",
      "contact",
      "/api/opportunities/parent%2F1/contacts",
    ],
    ["group_contact", "group", "contact", "/api/groups/parent%2F1/contacts"],
    [
      "activity_contact",
      "activity",
      "contact",
      "/api/activities/parent%2F1/contacts",
    ],
    [
      "activity_company",
      "activity",
      "company",
      "/api/activities/parent%2F1/companies",
    ],
    [
      "activity_opportunity",
      "activity",
      "opportunity",
      "/api/activities/parent%2F1/opportunities",
    ],
    ["note_contact", "note", "contact", "/api/notes/parent%2F1/contacts"],
    ["note_company", "note", "company", "/api/notes/parent%2F1/companies"],
    [
      "note_opportunity",
      "note",
      "opportunity",
      "/api/notes/parent%2F1/opportunities",
    ],
    [
      "history_contact",
      "history",
      "contact",
      "/api/history/parent%2F1/contacts",
    ],
    [
      "history_company",
      "history",
      "company",
      "/api/history/parent%2F1/companies",
    ],
    [
      "history_opportunity",
      "history",
      "opportunity",
      "/api/history/parent%2F1/opportunities",
    ],
  ] as const)(
    "reads the %s relationship stream",
    async (_streamType, parentKind, targetKind, path) => {
      const { transport, requests } = recordingReadTransport({
        value: [{ id: "related-1" }],
      });
      const client = new HttpActMigrationSourceClient(transport);

      if (
        parentKind === "activity" ||
        parentKind === "note" ||
        parentKind === "history"
      ) {
        await client.listRelated({
          parentKind,
          parentId: "parent/1",
          targetKind,
          request: plain,
        });
      } else if (parentKind === "contact") {
        await client.listCompaniesForContact("parent/1", plain);
      } else if (parentKind === "opportunity" && targetKind === "company") {
        await client.listCompaniesForOpportunity("parent/1", plain);
      } else if (parentKind === "opportunity") {
        await client.listContactsForOpportunity("parent/1", plain);
      } else {
        await client.listContactsForGroup("parent/1", plain);
      }

      expect(requests).toEqual([{ path, query: { $skip: "0", $top: "100" } }]);
    },
  );

  it("does not impose the retired 500-row or date cap", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => ({
      id: `history-${index}`,
    }));
    const { transport, requests } = recordingReadTransport(rows);

    await expect(
      new HttpActMigrationSourceClient(transport).listRoot("history", {
        skip: 500,
        top: 200,
        queryMode: "plain",
      }),
    ).resolves.toMatchObject({ nextSkip: 700, queryMode: "plain" });

    expect(requests).toEqual([
      {
        path: "/api/history",
        query: { $skip: "500", $top: "200" },
      },
    ]);
  });
});

describe("HttpActMigrationSourceClient projected fallback", () => {
  it("requests plain mode after an empty first projected page", async () => {
    const { transport } = recordingReadTransport({ value: [] });

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes(projected),
    ).resolves.toEqual({ items: [], nextSkip: 0, queryMode: "plain" });
  });

  it("requests plain mode after query_rejected on the first projected page", async () => {
    const { transport } = recordingReadTransport(() => {
      throw new ActApiError("query_rejected", false);
    });

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes(projected),
    ).resolves.toEqual({ items: [], nextSkip: 0, queryMode: "plain" });
  });

  it.each([
    "authentication_failed",
    "permission_denied",
    "not_found",
    "endpoint_unsupported",
    "rate_limited",
    "timeout",
    "unavailable",
    "invalid_response",
  ] as const)("does not fall back after %s", async (code) => {
    const expected = new ActApiError(code, false);
    const { transport } = recordingReadTransport(() => {
      throw expected;
    });

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes(projected),
    ).rejects.toBe(expected);
  });

  it("does not fall back after query_rejected beyond the first projected page", async () => {
    const expected = new ActApiError("query_rejected", false);
    const { transport } = recordingReadTransport(() => {
      throw expected;
    });

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes({
        ...projected,
        skip: 100,
      }),
    ).rejects.toBe(expected);
  });

  it("does not fall back from an empty later projected page", async () => {
    const { transport } = recordingReadTransport([]);

    await expect(
      new HttpActMigrationSourceClient(transport).listNotes({
        ...projected,
        skip: 100,
      }),
    ).resolves.toEqual({ items: [], nextSkip: null, queryMode: "projected" });
  });
});
