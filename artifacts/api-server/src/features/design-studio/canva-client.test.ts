import { describe, expect, it } from "vitest";
import { hasRequiredCanvaScopes } from "./canva-client";

describe("Canva required scopes", () => {
  it("accepts the complete Design Studio grant", () => {
    expect(
      hasRequiredCanvaScopes(["design:content:write", "design:meta:read"]),
    ).toBe(true);
  });

  it("accepts additional Canva scopes without weakening the required set", () => {
    expect(
      hasRequiredCanvaScopes([
        "profile:read",
        "design:meta:read",
        "design:content:write",
      ]),
    ).toBe(true);
  });

  it("requires reconnect when metadata-read permission is missing", () => {
    expect(hasRequiredCanvaScopes(["design:content:write"])).toBe(false);
  });

  it("requires reconnect when import permission is missing", () => {
    expect(hasRequiredCanvaScopes(["design:meta:read"])).toBe(false);
  });
});
