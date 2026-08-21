import { describe, expect, it } from "vitest";

import { resolveEventProfileRouteId } from "./event-profile-route-id";

describe("resolveEventProfileRouteId", () => {
  it("prefers the explicit profile id passed by the app route", () => {
    expect(resolveEventProfileRouteId("profile-from-route-prop", { id: "legacy-id" })).toBe("profile-from-route-prop");
  });

  it("supports both current and legacy route parameter names", () => {
    expect(resolveEventProfileRouteId(undefined, { profileId: "profiles-route-id" })).toBe("profiles-route-id");
    expect(resolveEventProfileRouteId(undefined, { id: "event-profiles-route-id" })).toBe("event-profiles-route-id");
  });

  it("returns an empty id instead of leaving the page loading forever", () => {
    expect(resolveEventProfileRouteId(undefined, {})).toBe("");
  });
});
