import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  canonicalJson,
  fingerprintSourceContent,
  sanitizeSourceContent,
  SourceFingerprintError,
} from "./source-fingerprint";

describe("Act source fingerprinting", () => {
  it("sorts object keys recursively without changing array order", () => {
    expect(
      canonicalJson({
        z: [{ b: 2, a: 1 }, "second", "first"],
        a: { d: 4, c: 3 },
      }),
    ).toBe('{"a":{"c":3,"d":4},"z":[{"a":1,"b":2},"second","first"]}');
  });

  it("removes only exact credential-like keys recursively and case-insensitively", () => {
    const source = {
      Authorization: "Basic secret",
      nested: {
        "ACCESS-TOKEN": "secret",
        access_token: "secret",
        "bearer-token": "secret",
        BEARER_TOKEN: "secret",
        Password: "secret",
        ToKeN: "secret",
        tokenizedName: "safe",
        accessTokenLabel: "safe",
      },
      rows: [
        { authorization: "secret", value: 1 },
        { tokenizedName: "still safe", value: 2 },
      ],
    };

    expect(sanitizeSourceContent(source)).toEqual({
      nested: {
        tokenizedName: "safe",
        accessTokenLabel: "safe",
      },
      rows: [{ value: 1 }, { tokenizedName: "still safe", value: 2 }],
    });
    expect(source.Authorization).toBe("Basic secret");
    expect(source.nested.Password).toBe("secret");
  });

  it("fingerprints sanitized raw content only", () => {
    const first = fingerprintSourceContent({
      name: "Ada",
      nested: { b: 2, a: 1 },
      authorization: "first secret",
    });
    const second = fingerprintSourceContent({
      nested: { a: 1, b: 2 },
      Authorization: "second secret",
      name: "Ada",
    });

    expect(first).toBe(second);
    expect(first).toBe(
      createHash("sha256")
        .update('{"name":"Ada","nested":{"a":1,"b":2}}')
        .digest("hex"),
    );
    expect(fingerprintSourceContent({ name: "Grace" })).not.toBe(first);
  });

  it("represents valid Dates deterministically", () => {
    expect(canonicalJson({ when: new Date("2026-08-01T15:30:00.000Z") })).toBe(
      '{"when":"2026-08-01T15:30:00.000Z"}',
    );
  });

  it("preserves JSON __proto__ keys without changing object prototypes", () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":{"safe":true}}',
    ) as Record<string, unknown>;

    const sanitized = sanitizeSourceContent(source);

    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
    expect(
      Object.getPrototypeOf(
        (sanitized as { __proto__: Record<string, unknown> }).__proto__,
      ),
    ).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(sanitized, "__proto__")).toBe(
      true,
    );
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
    expect(canonicalJson(sanitized)).toBe(
      '{"__proto__":{"polluted":true},"constructor":{"safe":true}}',
    );
  });

  it.each([
    ["one hole", new Array(1)],
    ["several holes", new Array(4)],
    ["a nested hole", { rows: [[1, , 3]] }],
  ])(
    "rejects sparse arrays with %s using the stable safe error",
    (_name, source) => {
      expect(() => canonicalJson(source)).toThrow(SourceFingerprintError);
      expect(() => canonicalJson(source)).toThrow(
        "Source content cannot be archived safely.",
      );
    },
  );

  it("never canonicalizes a sparse array as the same value as a dense array", () => {
    const sparse = new Array(1);

    expect(() => canonicalJson(sparse)).toThrow(SourceFingerprintError);
    expect(canonicalJson([])).toBe("[]");
    expect(canonicalJson([null])).toBe("[null]");
  });

  it.each([
    ["undefined", { value: undefined }],
    ["non-finite number", { value: Number.POSITIVE_INFINITY }],
    ["bigint", { value: 1n }],
    ["function", { value: () => undefined }],
    ["symbol", { value: Symbol("unsafe") }],
    ["symbol-keyed property", { [Symbol("unsafe")]: "value" }],
    ["invalid Date", { value: new Date("invalid") }],
    ["non-plain object", { value: new Map([["key", "value"]]) }],
  ])("rejects %s with the same safe stable error", (_name, source) => {
    let thrown: unknown;
    try {
      canonicalJson(source);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(SourceFingerprintError);
    expect(thrown).toMatchObject({
      code: "INVALID_SOURCE_CONTENT",
      message: "Source content cannot be archived safely.",
    });
  });

  it("rejects circular source content without exposing source values", () => {
    const source: Record<string, unknown> = { value: "private source value" };
    source.self = source;

    expect(() => canonicalJson(source)).toThrow(
      "Source content cannot be archived safely.",
    );
    try {
      canonicalJson(source);
    } catch (error) {
      expect(String(error)).not.toContain("private source value");
    }
  });
});
