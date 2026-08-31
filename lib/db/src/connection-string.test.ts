import { describe, expect, it } from "vitest";

import { normalizeDatabaseConnectionString } from "./connection-string";

describe("normalizeDatabaseConnectionString", () => {
  it("adds verify-full for Render without weakening TLS semantics", () => {
    expect(
      normalizeDatabaseConnectionString(
        "postgresql://user:pass@example.com:5432/app",
        { isRender: true },
      ),
    ).toBe("postgresql://user:pass@example.com:5432/app?sslmode=verify-full");
  });

  it("preserves existing query parameters when adding Render SSL", () => {
    expect(
      normalizeDatabaseConnectionString(
        "postgresql://user:pass@example.com:5432/app?connect_timeout=10",
        { isRender: true },
      ),
    ).toBe(
      "postgresql://user:pass@example.com:5432/app?connect_timeout=10&sslmode=verify-full",
    );
  });

  it("upgrades pg aliases that currently mean verify-full", () => {
    expect(
      normalizeDatabaseConnectionString(
        "postgresql://user:pass@example.com:5432/app?sslmode=require",
        { isRender: true },
      ),
    ).toBe("postgresql://user:pass@example.com:5432/app?sslmode=verify-full");
  });

  it("leaves non-Render database URLs unchanged", () => {
    const input = "postgresql://user:pass@localhost:5432/app?sslmode=disable";
    expect(normalizeDatabaseConnectionString(input, { isRender: false })).toBe(input);
  });
});
