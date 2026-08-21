import { describe, expect, it } from "vitest";

import { explicitLinkedTarget } from "./review-cleanup";

describe("explicitLinkedTarget", () => {
  it("extracts an explicit company ownership clue", () => {
    expect(explicitLinkedTarget({
      streamType: "history",
      rawSnapshot: { regarding: "Linked to company Summer Market Days" },
    })).toEqual({ entityType: "organization", name: "Summer Market Days" });
  });

  it("extracts an explicit contact ownership clue", () => {
    expect(explicitLinkedTarget({
      streamType: "history",
      rawSnapshot: { details: "Linked to contact Jane Smith" },
    })).toEqual({ entityType: "contact", name: "Jane Smith" });
  });

  it("extracts an explicit opportunity ownership clue", () => {
    expect(explicitLinkedTarget({
      streamType: "history",
      rawSnapshot: { regarding: "Linked to opportunity Summer Fair 2025" },
    })).toEqual({ entityType: "booking", name: "Summer Fair 2025" });
  });

  it("does not treat generic linked-to bookkeeping as ownership evidence", () => {
    expect(explicitLinkedTarget({
      streamType: "history",
      rawSnapshot: { regarding: "(Linked To)" },
    })).toBeNull();
  });
});
