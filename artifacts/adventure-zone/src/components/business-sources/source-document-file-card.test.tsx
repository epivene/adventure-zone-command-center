import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/business-sources/source-document-file-card.tsx", "utf8");

describe("SourceDocumentFileCard protected open", () => {
  it("uses the owner-authorized POST open endpoint and never stores a permanent key", () => {
    expect(source).toContain("apiPost<{ url: string }>");
    expect(source).toContain("`/business-sources/${documentId}/file/open`");
    expect(source).not.toContain("storageKey");
    expect(source).not.toContain("business-source-documents/");
    expect(source).not.toContain("storage.googleapis.com");
  });
});
