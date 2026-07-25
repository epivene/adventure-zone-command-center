import { describe, expect, it } from "vitest";
import { authorizeOwner } from "@/lib/auth/require-owner";

describe("authorizeOwner", () => {
  it("accepts the configured owner", () => {
    expect(authorizeOwner("user_desiree", "user_desiree")).toEqual({
      userId: "user_desiree",
    });
  });

  it("rejects every other authenticated user", () => {
    expect(() => authorizeOwner("user_other", "user_desiree")).toThrow(
      "Not authorized",
    );
  });
});
