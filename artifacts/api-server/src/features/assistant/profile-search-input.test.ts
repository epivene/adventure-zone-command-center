import { describe, expect, it } from "vitest";
import { profileSearchInputSchema } from "./profile-search-input";

describe("profileSearchInputSchema", () => {
  it("parses literal true and false query strings without truthy-string coercion", () => {
    expect(profileSearchInputSchema.parse({ q: "fair", overdueFollowUp: "true" }).overdueFollowUp).toBe(true);
    expect(profileSearchInputSchema.parse({ q: "fair", overdueFollowUp: "false" }).overdueFollowUp).toBe(false);
  });

  it("rejects arbitrary search-control fields", () => {
    expect(profileSearchInputSchema.safeParse({ q: "fair", where: "drop table bookings" }).success).toBe(false);
    expect(profileSearchInputSchema.safeParse({ q: "fair", legId: crypto.randomUUID() }).success).toBe(false);
  });
});
