import { describe, expect, it } from "vitest";

import type { ContactListPage, ContactListQuery, ContactListRecord } from "./contact-types";
import { ForgivingContactSearchService } from "./forgiving-contact-search";

function contact(id: string, firstName: string, lastName: string, organizationName: string, region: string): ContactListRecord {
  return {
    id,
    firstName,
    lastName,
    organizationName,
    jobTitle: null,
    email: null,
    phone: null,
    address1: null,
    address2: null,
    city: "Rock Springs",
    region,
    postalCode: null,
    syncState: "unlinked",
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    lastSyncedAt: null,
  };
}

describe("forgiving contact search", () => {
  it("falls back to close matches across contact and profile fields", async () => {
    const candidates = [
      contact("1", "Mary", "Johnson", "Rock Springs Fair", "Wyoming"),
      contact("2", "David", "Smith", "Colorado Expo", "Colorado"),
    ];
    const repository = {
      async listContacts(query: ContactListQuery): Promise<ContactListPage> {
        const records = query.search ? [] : candidates;
        return { records, total: records.length, page: 1, pageSize: query.pageSize, pageCount: 1 };
      },
    };
    const service = new ForgivingContactSearchService(repository);
    expect(await service.listContacts({ search: "wryomin", state: "all", page: 1, pageSize: 50 }))
      .toMatchObject({ records: [{ id: "1" }], total: 1 });
    expect(await service.listContacts({ search: "jonsen", state: "all", page: 1, pageSize: 50 }))
      .toMatchObject({ records: [{ id: "1" }], total: 1 });
  });
});
