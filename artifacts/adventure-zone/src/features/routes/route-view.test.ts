import { describe, expect, it } from "vitest";

import { classifyRouteBucket } from "./route-view";

describe("classifyRouteBucket", () => {
  it("treats operationally committed bookings as confirmed routes", () => {
    expect(classifyRouteBucket("contract_received", "definite")).toBe("confirmed");
    expect(classifyRouteBucket("possible", "definite")).toBe("confirmed");
    expect(classifyRouteBucket("possible", "possible")).toBe("potential");
  });

  it("keeps cancelled definite bookings out of active routes", () => {
    expect(classifyRouteBucket("cancelled", "definite")).toBe("history");
  });
});