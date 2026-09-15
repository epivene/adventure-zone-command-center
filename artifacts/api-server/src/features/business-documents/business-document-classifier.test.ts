import { describe, expect, it } from "vitest";
import { classifyBusinessDocument } from "./business-document-classifier";

describe("business document classifier", () => {
  it("classifies an unambiguous invoice filename", () => {
    expect(classifyBusinessDocument({
      filename: "AZ-2027-001 invoice.pdf",
      mimeType: "application/pdf",
    })).toMatchObject({ decision: "auto", category: "invoice" });
  });
});
