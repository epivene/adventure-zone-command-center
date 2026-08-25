import { afterEach, describe, expect, it } from "vitest";
import { verifyAssistantImportToken } from "./assistant-import-auth";

const originalToken = process.env.ASSISTANT_IMPORT_TOKEN;

afterEach(() => {
  if (originalToken === undefined) delete process.env.ASSISTANT_IMPORT_TOKEN;
  else process.env.ASSISTANT_IMPORT_TOKEN = originalToken;
});

describe("verifyAssistantImportToken", () => {
  it("fails closed when ASSISTANT_IMPORT_TOKEN is not configured", () => {
    delete process.env.ASSISTANT_IMPORT_TOKEN;
    expect(verifyAssistantImportToken("anything")).toBe(false);
  });

  it("rejects an incorrect token", () => {
    process.env.ASSISTANT_IMPORT_TOKEN = "expected-secret";
    expect(verifyAssistantImportToken("wrong-secret")).toBe(false);
  });

  it("accepts the configured token", () => {
    process.env.ASSISTANT_IMPORT_TOKEN = "expected-secret";
    expect(verifyAssistantImportToken("expected-secret")).toBe(true);
  });
});
