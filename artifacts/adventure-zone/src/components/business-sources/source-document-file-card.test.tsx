import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/business-sources/source-document-file-card.tsx", "utf8");

describe("SourceDocumentFileCard protected open", () => {
  it("uses one exported owner-authorized signed-link helper", () => {
    expect(source).toContain("export async function openSourceDocument");
    expect(source).toContain("apiPost<{ url: string }>");
    expect(source).toContain("`/business-sources/${documentId}/file/open`");
    expect(source).toContain('window.open(url, "_blank", "noopener,noreferrer")');
    expect(source).not.toContain("storageKey");
    expect(source).not.toContain("business-source-documents/");
    expect(source).not.toContain("storage.googleapis.com");
  });

  it("reuses the helper from the protected file management card", () => {
    expect(source).toContain("await openSourceDocument(documentId)");
    expect(source).toContain("Open document");
  });
});
