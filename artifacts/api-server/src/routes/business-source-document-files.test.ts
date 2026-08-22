import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/business-source-document-files.ts", "utf8");
const index = readFileSync("src/routes/index.ts", "utf8");

describe("business source document file routes", () => {
  it("supports owner upload, signed open, and delete with a 30 MB raw body", () => {
    expect(source).toContain('/business-sources/:documentId/file');
    expect(source).toContain('express.raw({ type: "*/*", limit: "30mb" })');
    expect(source).toContain("uploadSourceDocumentFile");
    expect(source).toContain("getSourceDocumentSignedReadUrl");
    expect(source).toContain("deleteSourceDocumentFile");
    expect(source).toContain("res.redirect(302, signedUrl)");
  });

  it("offers an owner-authorized browser open endpoint without returning the persistent key", () => {
    expect(source).toContain('/business-sources/:documentId/file/open');
    expect(source).toContain("res.json({ url: signedUrl })");
  });

  it("never returns a persistent storage key to the frontend", () => {
    expect(source).toContain("safeFileMetadata");
    expect(source).not.toContain("res.json({ file })");
    expect(source).not.toContain("storageKey: file.storageKey");
  });

  it("mounts the file router only after owner authentication", () => {
    const ownerGate = index.indexOf("router.use(requireOwnerMiddleware)");
    const mount = index.indexOf("router.use(businessSourceDocumentFilesRouter)");
    expect(mount).toBeGreaterThan(ownerGate);
  });
});
