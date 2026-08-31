import { describe, expect, it } from "vitest";
import { canvaPkceChallenge, safeCanvaReturnPath } from "./canva-oauth";

describe("Canva OAuth PKCE", () => {
  it("matches the RFC 7636 S256 challenge vector", () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    expect(canvaPkceChallenge(verifier)).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});

describe("Canva OAuth return path", () => {
  it("allows Design Studio project paths", () => {
    expect(safeCanvaReturnPath("/design-studio/123?tab=editor")).toBe(
      "/design-studio/123?tab=editor",
    );
  });

  it("falls back for protocol-relative redirects", () => {
    expect(safeCanvaReturnPath("//evil.example/design-studio")).toBe(
      "/design-studio",
    );
  });

  it("falls back for non-Design-Studio routes", () => {
    expect(safeCanvaReturnPath("/admin/settings")).toBe("/design-studio");
    expect(safeCanvaReturnPath("https://evil.example/design-studio")).toBe(
      "/design-studio",
    );
  });
});
