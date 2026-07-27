import { describe, expect, it } from "vitest";

import { parseActEnvironment } from "@/lib/env";

describe("Act environment", () => {
  it("returns an unconfigured state when no Act values exist", () => {
    expect(parseActEnvironment({})).toEqual({ configured: false });
  });

  it("accepts the fixed U.S. Act! Premium Cloud endpoint", () => {
    expect(
      parseActEnvironment({
        ACT_API_BASE_URL: "https://apius.act.com/act.web.api",
        ACT_DATABASE_NAME: "TEST-ACT-DATABASE",
        ACT_USERNAME: "shared-user",
        ACT_PASSWORD: "private-password",
      }),
    ).toEqual({
      configured: true,
      config: {
        baseUrl: "https://apius.act.com/act.web.api",
        databaseName: "TEST-ACT-DATABASE",
        username: "shared-user",
        password: "private-password",
      },
    });
  });

  it("rejects an arbitrary API host", () => {
    expect(() =>
      parseActEnvironment({
        ACT_API_BASE_URL: "https://example.com/act.web.api",
        ACT_DATABASE_NAME: "TEST-ACT-DATABASE",
        ACT_USERNAME: "shared-user",
        ACT_PASSWORD: "private-password",
      }),
    ).toThrow();
  });

  it("rejects partially configured credentials", () => {
    expect(() =>
      parseActEnvironment({
        ACT_API_BASE_URL: "https://apius.act.com/act.web.api",
        ACT_DATABASE_NAME: "TEST-ACT-DATABASE",
      }),
    ).toThrow();
  });
});
