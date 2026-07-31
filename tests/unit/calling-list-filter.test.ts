import { describe, expect, it } from "vitest";

import {
  callingListFilterV1Schema,
  parseCallingListFilterV1,
} from "@/features/calling-lists/calling-list-filter";

describe("calling-list filter v1", () => {
  it("accepts a supported Person-and-Place predicate tree", () => {
    expect(
      parseCallingListFilterV1({
        version: 1,
        entity: "person",
        where: {
          op: "and",
          clauses: [
            {
              op: "predicate",
              field: "place.region",
              operator: "eq",
              value: "MT",
            },
            {
              op: "predicate",
              field: "person.job_title",
              operator: "is_not_empty",
            },
          ],
        },
      }),
    ).toMatchObject({ version: 1, entity: "person" });
  });

  it("rejects unknown fields, mismatched values, and empty boolean clauses", () => {
    expect(() =>
      parseCallingListFilterV1({
        version: 1,
        entity: "person",
        where: {
          op: "predicate",
          field: "person.email",
          operator: "eq",
          value: "x@example.test",
        },
      }),
    ).toThrow();
    expect(() =>
      parseCallingListFilterV1({
        version: 1,
        entity: "person",
        where: {
          op: "predicate",
          field: "person.region",
          operator: "in",
          value: "MT",
        },
      }),
    ).toThrow();
    expect(() =>
      parseCallingListFilterV1({
        version: 1,
        entity: "person",
        where: { op: "or", clauses: [] },
      }),
    ).toThrow();
    expect(
      callingListFilterV1Schema.safeParse({
        version: 1,
        entity: "person",
        extra: true,
        where: {
          op: "predicate",
          field: "person.city",
          operator: "eq",
          value: "Billings",
        },
      }).success,
    ).toBe(false);
  });

  it("bounds the recursive tree at eight levels and fifty clauses", () => {
    let where: unknown = {
      op: "predicate",
      field: "person.region",
      operator: "eq",
      value: "MT",
    };
    for (let level = 0; level < 8; level += 1) {
      where = { op: "and", clauses: [where] };
    }
    expect(
      callingListFilterV1Schema.safeParse({
        version: 1,
        entity: "person",
        where,
      }).success,
    ).toBe(false);

    expect(() =>
      parseCallingListFilterV1({
        version: 1,
        entity: "person",
        where: {
          op: "and",
          clauses: Array.from({ length: 51 }, () => ({
            op: "predicate",
            field: "person.region",
            operator: "eq",
            value: "MT",
          })),
        },
      }),
    ).toThrow();
  });
});
