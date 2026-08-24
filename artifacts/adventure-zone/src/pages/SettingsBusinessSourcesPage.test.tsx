import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/SettingsBusinessSourcesPage.tsx", "utf8");
const fileCard = readFileSync("src/components/business-sources/source-document-file-card.tsx", "utf8");
const linkEditor = readFileSync("src/components/business-sources/source-document-link-editor.tsx", "utf8");

describe("Business Sources protected document controls", () => {
  it("shows safe upload state and accepts only reviewed file types", () => {
    expect(page).toContain("SourceDocumentFileCard");
    expect(fileCard).toContain("application/pdf");
    expect(fileCard).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(fileCard).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(fileCard).toContain("Upload or replace file");
    expect(fileCard).toContain("Uploaded");
  });

  it("surfaces a visible View file action before the management disclosure", () => {
    expect(page).toContain("openSourceDocument");
    expect(page).toContain(">View file<");
    expect(page).toContain("source.file.originalSizeBytes");
    expect(page).toContain("source.hasFile && source.file");
  });

  it("supports explicit profile/location/booking/package linking and historical term review", () => {
    expect(page).toContain("SourceDocumentLinkEditor");
    expect(linkEditor).toContain("Historical terms");
    expect(linkEditor).toContain("profile");
    expect(linkEditor).toContain("location");
    expect(linkEditor).toContain("booking");
    expect(linkEditor).toContain("package_reference");
  });

  it("never renders or stores persistent object keys in the source settings UI", () => {
    expect(page).not.toContain("storageKey");
    expect(fileCard).not.toContain("storageKey");
    expect(linkEditor).not.toContain("storageKey");
  });
});
