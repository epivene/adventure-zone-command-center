import { describe, expect, it } from "vitest";
import { importLeadWorkbookSchema, leadImportActor } from "./lead-intake-input";

const valid = {
  originalFilename: "Sept Week 3.xls",
  fileSha256: "a".repeat(64),
  rows: [{
    sheetName: "Sheet1", rowNumber: 2, company: "Aspen Filmfest",
    phone: null, address1: null, address2: null, city: "Aspen", state: "CO",
    zipCode: null, website: null, industry: null, originalValues: { Company: "Aspen Filmfest" },
  }],
};

describe("importLeadWorkbookSchema", () => {
  it("accepts the parser payload without requiring missing contact fields", () => {
    expect(importLeadWorkbookSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a claimed file hash or unsupported file type", () => {
    expect(importLeadWorkbookSchema.safeParse({ ...valid, fileSha256: "not-a-hash" }).success).toBe(false);
    expect(importLeadWorkbookSchema.safeParse({ ...valid, originalFilename: "leads.csv" }).success).toBe(false);
  });

  it("rejects more than 5,000 rows", () => {
    expect(importLeadWorkbookSchema.safeParse({ ...valid, rows: Array(5_001).fill(valid.rows[0]) }).success).toBe(false);
  });

  it("records the single-owner actor when middleware uses an empty namespace id", () => {
    expect(leadImportActor("")).toBe("owner");
    expect(leadImportActor("  amy  ")).toBe("amy");
  });
});
