import { describe, expect, it } from "vitest";

import {
  canonicalCallsPath,
  canonicalProfilePath,
  canonicalSchedulePath,
} from "./canonical-routes";

describe("canonical route helpers", () => {
  it("preserves calling context while moving old call routes to Calls", () => {
    expect(canonicalCallsPath("?contactId=1&bookingId=2")).toBe(
      "/calls/workspace?contactId=1&bookingId=2",
    );
  });

  it("normalizes Schedule map view ahead of preserved filters", () => {
    expect(canonicalSchedulePath({ view: "map", search: "?season=2027&leg=abc" })).toBe(
      "/schedule?view=map&season=2027&leg=abc",
    );
  });

  it("does not emit duplicate canonical schedule keys", () => {
    expect(canonicalSchedulePath({
      view: "map",
      search: "?view=calendar&season=2027&season=2028&leg=abc&status=confirmed",
    })).toBe("/schedule?view=map&season=2027&leg=abc&status=confirmed");
  });

  it("builds canonical profile detail URLs", () => {
    expect(canonicalProfilePath("profile-123")).toBe("/profiles/profile-123");
  });
});
