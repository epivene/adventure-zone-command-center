import { describe, expect, it } from "vitest";

import { DrizzleContactRepository } from "./contact-repository";
import type { QuickCallerInput } from "./contact-types";

const input: QuickCallerInput = {
  requestKey: "11111111-1111-4111-8111-111111111111",
  firstName: "Avery",
  lastName: "Lee",
  organizationName: "North Star Events",
  phone: "701-555-0199",
  email: "avery@example.com",
  reason: "New inquiry",
  eventDate: null,
  eventLocation: "Fargo, ND",
  continueCreating: true,
};

function thenableRows(rows: unknown[]) {
  const builder = {
    from: () => builder,
    leftJoin: () => builder,
    where: () => builder,
    orderBy: () => builder,
    limit: () => builder,
    for: () => builder,
    then: (
      resolve: (value: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rows).then(resolve, reject),
  };
  return builder;
}

function databaseWithHiddenExact() {
  const likelyRows = Array.from({ length: 8 }, (_, index) => ({
    contactId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    firstName: "Avery",
    lastName: "Lee",
    organizationName: "North Star Events",
    city: "Fargo",
    region: "ND",
    exactPhone: false,
    exactEmail: false,
    nameAndOrganization: true,
    nameAndLocation: false,
  }));
  let insertCount = 0;
  const transaction = {
    execute: async () => undefined,
    select(selection: Record<string, unknown>) {
      if ("exactExists" in selection) {
        return thenableRows([{ exactExists: true }]);
      }
      if ("exactPhone" in selection) {
        return thenableRows(likelyRows);
      }
      return thenableRows([]);
    },
    insert() {
      insertCount += 1;
      throw new Error("unsafe insert reached");
    },
  };
  return {
    database: {
      transaction: async <T>(
        callback: (writer: typeof transaction) => Promise<T>,
      ) => callback(transaction),
    },
    insertCount: () => insertCount,
    likelyRows,
  };
}

describe("quick caller repository duplicate gate", () => {
  it("rechecks uncapped exact existence inside the transaction before continuing past likely matches", async () => {
    const store = databaseWithHiddenExact();
    const repository = new DrizzleContactRepository(store.database as never);

    const result = await repository.createQuickCaller(input);

    expect(result).toEqual({
      kind: "candidates",
      canContinueCreating: false,
      candidates: store.likelyRows.map((row) => ({
        contactId: row.contactId,
        name: "Avery Lee",
        organizationName: "North Star Events",
        city: "Fargo",
        region: "ND",
        reasons: ["Name and organization"],
        kind: "likely",
      })),
    });
    expect(store.insertCount()).toBe(0);
  });
});
