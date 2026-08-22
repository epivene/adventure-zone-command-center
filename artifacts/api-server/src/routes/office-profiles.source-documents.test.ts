import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/office-profile-source-documents.ts", "utf8");
const index = readFileSync("src/routes/index.ts", "utf8");

describe("Office profile source documents", () => {
  it("uses Office authentication and the shared Office-scoped projection", () => {
    expect(source).toContain("requireOffice");
    expect(source).toContain('/office/profiles/:profileId/source-documents');
    expect(source).toContain('listProfileSourceDocuments(db, profileId, "office")');
  });

  it("mounts before the owner gate and never grants owner file-open access", () => {
    expect(index.indexOf("router.use(officeProfileSourceDocumentsRouter)")).toBeLessThan(index.indexOf("router.use(requireOwnerMiddleware)"));
    expect(source).not.toContain("business-sources/:documentId/file");
  });
});
