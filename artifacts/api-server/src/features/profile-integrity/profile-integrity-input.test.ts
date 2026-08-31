import { describe, expect, it } from "vitest";

import { readProfileIntegrityId } from "./profile-integrity-input";

describe("readProfileIntegrityId", () => {
  it("accepts normal versioned UUIDs used by live organization profiles", () => {
    expect(readProfileIntegrityId("08e8e9b8-618a-4129-ab14-640345c1abf0"))
      .toBe("08e8e9b8-618a-4129-ab14-640345c1abf0");
    expect(readProfileIntegrityId("0bfee77c-e42c-417f-9d5e-7df54d57c38b"))
      .toBe("0bfee77c-e42c-417f-9d5e-7df54d57c38b");
  });

  it("accepts an Express array parameter by reading its first value", () => {
    expect(readProfileIntegrityId([
      "08e8e9b8-618a-4129-ab14-640345c1abf0",
      "ignored",
    ])).toBe("08e8e9b8-618a-4129-ab14-640345c1abf0");
  });

  it("rejects malformed, missing-hyphen, and non-versioned identifiers", () => {
    expect(readProfileIntegrityId(undefined)).toBeNull();
    expect(readProfileIntegrityId("08e8e9b8618a4129ab14640345c1abf0")).toBeNull();
    expect(readProfileIntegrityId("08e8e9b8-618a-0129-ab14-640345c1abf0")).toBeNull();
  });
});
