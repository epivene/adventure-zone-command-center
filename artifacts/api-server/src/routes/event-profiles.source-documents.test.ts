import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/profile-source-documents.ts", "utf8");
const index = readFileSync("src/routes/index.ts", "utf8");

describe("owner profile source documents", () => {
  it("returns role-filtered linked source document metadata from the shared service", () => {
    expect(source).toContain('/event-profiles/:profileId/source-documents');
    expect(source).toContain('listProfileSourceDocuments(db, profileId, "owner")');
  });

  it("mounts after owner authentication", () => {
    expect(index.indexOf("router.use(profileSourceDocumentsRouter)")).toBeGreaterThan(index.indexOf("router.use(requireOwnerMiddleware)"));
  });
});
