import { describe, expect, it } from "vitest";

import { classifyBusinessDocument } from "./business-document-classifier";

function candidate(filename: string, mimeType = "application/pdf") {
  return { filename, mimeType, subject: "", bodyText: "" };
}

describe("classifyBusinessDocument", () => {
  it.each([
    ["AZ-2027-001 invoice.pdf", "invoice"],
    ["COI 24-25 - City of Victor.pdf", "coi"],
    ["2026 W9 signed.pdf", "w9_tax"],
    ["North Ogden Cherry Days Proposal.docx", "proposal"],
    ["Vendor Agreement Route County Fair.doc", "contract"],
    ["24-25 Insurance Renewal Docs.pdf", "insurance_policy"],
  ] as const)("classifies %s as %s", (filename, category) => {
    expect(classifyBusinessDocument(candidate(filename))).toMatchObject({
      category,
      decision: "auto",
    });
  });

  it.each(["~$North Ogden.docx", "draft.tmp", "desktop.ini"])(
    "skips temporary or system file %s",
    (filename) => {
      expect(classifyBusinessDocument(candidate(filename))).toEqual({
        decision: "skip",
        errorCode: "business_document_temporary_file",
      });
    },
  );

  it("routes an unknown business-looking file to review", () => {
    expect(classifyBusinessDocument(candidate("City paperwork.pdf"))).toMatchObject({
      category: "other",
      decision: "review",
    });
  });
});
