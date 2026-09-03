import { describe, expect, it } from "vitest";

import {
  FixedWindowInquiryRateLimiter,
  InquiryOriginError,
  assertAllowedInquiryPage,
  readWebsiteInquiryAllowedOrigins,
} from "./public-security";

describe("website inquiry public security", () => {
  it("uses only configured origins in production", () => {
    const origins = readWebsiteInquiryAllowedOrigins(
      {
        WEBSITE_INQUIRY_ALLOWED_ORIGINS:
          "https://the-adventure-zone.com, https://www.the-adventure-zone.com",
      },
      "production",
    );
    expect([...origins]).toEqual([
      "https://the-adventure-zone.com",
      "https://www.the-adventure-zone.com",
    ]);
    expect(origins.has("http://localhost:5173")).toBe(false);
  });

  it("fails closed when production origins are missing", () => {
    expect(() => readWebsiteInquiryAllowedOrigins({}, "production")).toThrow(
      "WEBSITE_INQUIRY_ALLOWED_ORIGINS",
    );
  });

  it("adds local origins outside production", () => {
    const origins = readWebsiteInquiryAllowedOrigins({}, "test");
    expect(origins.has("http://localhost:5173")).toBe(true);
    expect(origins.has("http://127.0.0.1:5173")).toBe(true);
  });

  it("requires the page URL and request origin to match the allowlist", () => {
    const allowed = new Set(["https://the-adventure-zone.com"]);
    expect(
      assertAllowedInquiryPage(
        "https://the-adventure-zone.com",
        "https://the-adventure-zone.com/contact?source=wix",
        allowed,
      ),
    ).toEqual({ origin: "https://the-adventure-zone.com" });
    expect(() =>
      assertAllowedInquiryPage(
        "https://evil.example",
        "https://the-adventure-zone.com/contact",
        allowed,
      ),
    ).toThrow(InquiryOriginError);
    expect(() =>
      assertAllowedInquiryPage(
        undefined,
        "https://the-adventure-zone.com/contact",
        allowed,
      ),
    ).toThrow(InquiryOriginError);
  });

  it("limits one digested client without affecting another", () => {
    let now = Date.parse("2026-09-03T16:00:00Z");
    const limiter = new FixedWindowInquiryRateLimiter({
      limit: 5,
      windowMs: 15 * 60_000,
      secret: "test-secret",
      now: () => now,
    });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.consume("203.0.113.10").allowed).toBe(true);
    }
    expect(limiter.consume("203.0.113.10")).toMatchObject({ allowed: false });
    expect(limiter.consume("203.0.113.11").allowed).toBe(true);

    const keys = [...(limiter as unknown as { windows: Map<string, unknown> }).windows.keys()];
    expect(keys.every((key) => key.length === 43)).toBe(true);
    expect(keys.join(" ")).not.toContain("203.0.113");

    now += 15 * 60_000;
    expect(limiter.consume("203.0.113.10").allowed).toBe(true);
  });
});
