import { describe, expect, it, vi } from "vitest";

import { HttpActMigrationSourceClient } from "@/features/act-migration/source-client";
import { ActClient } from "@/features/act-sync/act-client";
import type { ActConfig } from "@/features/act-sync/act-types";

const config: ActConfig = {
  baseUrl: "https://apius.act.com/act.web.api",
  databaseName: "TEST-ACT-DATABASE",
  username: "shared-user",
  password: "private-password",
};

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function migrationClient(pages: unknown[][]) {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let pageIndex = 0;
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      requests.push({ url, init });
      if (url.endsWith("/authorize")) {
        return jsonResponse({ token: "safe-test-token" });
      }
      return jsonResponse(pages[pageIndex++] ?? []);
    },
  );
  const transport = new ActClient(config, { fetcher });
  return {
    client: new HttpActMigrationSourceClient(transport),
    requests,
  };
}

describe("HttpActMigrationSourceClient", () => {
  it("uses the exact projected query and endpoint for every migration stream", async () => {
    const { client, requests } = migrationClient(
      Array.from({ length: 8 }, () => [{ id: "ROW-1" }]),
    );
    const page = { skip: 0, top: 200, queryMode: "projected" } as const;

    await client.listCompanies(page);
    await client.listContacts(page);
    await client.listOpportunities(page);
    await client.listGroups(page);
    await client.listCompaniesForContact("CONTACT-1", page);
    await client.listCompaniesForOpportunity("OPPORTUNITY-1", page);
    await client.listContactsForOpportunity("OPPORTUNITY-1", page);
    await client.listContactsForGroup("GROUP-1", page);

    const apiRequests = requests.filter(({ url }) => url.includes("/api/"));
    expect(apiRequests).toHaveLength(8);
    expect(apiRequests.map(({ url }) => new URL(url).pathname)).toEqual([
      "/act.web.api/api/companies",
      "/act.web.api/api/contacts",
      "/act.web.api/api/opportunities",
      "/act.web.api/api/groups",
      "/act.web.api/api/contacts/CONTACT-1/companies",
      "/act.web.api/api/opportunities/OPPORTUNITY-1/companies",
      "/act.web.api/api/opportunities/OPPORTUNITY-1/contacts",
      "/act.web.api/api/groups/GROUP-1/contacts",
    ]);
    expect(apiRequests[0]?.url).toContain("/api/companies?");
    expect(apiRequests[0]?.url).toContain("%24orderby=id");
    expect(apiRequests[4]?.url).toContain(
      "/api/contacts/CONTACT-1/companies?",
    );

    const queries = apiRequests.map(({ url }) => new URL(url).searchParams);
    for (const query of queries) {
      expect(query.get("$skip")).toBe("0");
      expect(query.get("$top")).toBe("200");
      expect(query.get("$orderby")).toBe("id");
    }
    expect(queries[0]?.get("$select")).toBe(
      "id,name,phone,website,industry,edited",
    );
    expect(queries[0]?.get("$expand")).toBe(
      "address($select=line1,line2,city,state,postalCode)",
    );
    expect(queries[1]?.get("$select")).toBe(
      "id,firstName,lastName,fullName,company,jobTitle,emailAddress,businessPhone,edited",
    );
    expect(queries[1]?.get("$expand")).toBe(
      "businessAddress($select=line1,line2,city,state,postalCode)",
    );
    expect(queries[2]?.get("$select")).toBe(
      "id,name,status,estimatedCloseDate,actualCloseDate,total,probability,edited",
    );
    expect(queries[2]?.get("$expand")).toBe(
      "stage($expand=process($select=name,id);$select=name,id)",
    );
    expect(queries[3]?.get("$select")).toBe("id,name,description,edited");
    expect(queries[3]?.has("$expand")).toBe(false);
    expect(queries[4]?.get("$select")).toBe(queries[0]?.get("$select"));
    expect(queries[5]?.get("$select")).toBe(queries[0]?.get("$select"));
    expect(queries[6]?.get("$select")).toBe(queries[1]?.get("$select"));
    expect(queries[7]?.get("$select")).toBe(queries[1]?.get("$select"));
  });

  it("advances a short page by its actual row count and only ends on an empty page", async () => {
    const { client } = migrationClient([
      [{ id: "COMPANY-1" }, { id: "COMPANY-2" }],
      [],
    ]);

    await expect(
      client.listCompanies({ skip: 40, top: 200, queryMode: "plain" }),
    ).resolves.toEqual({
      items: [{ id: "COMPANY-1" }, { id: "COMPANY-2" }],
      nextSkip: 42,
      queryMode: "plain",
    });
    await expect(
      client.listCompanies({ skip: 42, top: 200, queryMode: "plain" }),
    ).resolves.toEqual({
      items: [],
      nextSkip: null,
      queryMode: "plain",
    });
  });

  it("returns a plain-mode retry checkpoint for an empty first projected page", async () => {
    const { client, requests } = migrationClient([[]]);

    await expect(
      client.listOpportunities({
        skip: 0,
        top: 200,
        queryMode: "projected",
      }),
    ).resolves.toEqual({
      items: [],
      nextSkip: 0,
      queryMode: "plain",
    });

    expect(requests.filter(({ url }) => url.includes("/api/"))).toHaveLength(1);
  });

  it("omits projections and ordering in plain compatibility mode", async () => {
    const { client, requests } = migrationClient([[{ id: "CONTACT-1" }]]);

    await client.listContacts({
      skip: 0,
      top: 25,
      queryMode: "plain",
    });

    const query = new URL(requests.at(-1)!.url).searchParams;
    expect(query.get("$skip")).toBe("0");
    expect(query.get("$top")).toBe("25");
    expect(query.has("$select")).toBe(false);
    expect(query.has("$expand")).toBe(false);
    expect(query.has("$orderby")).toBe(false);
  });
});
