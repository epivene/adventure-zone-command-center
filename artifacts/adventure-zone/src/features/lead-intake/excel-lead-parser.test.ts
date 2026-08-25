import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import { parseLeadWorkbook } from "./excel-lead-parser";

const headers = [
  "Company",
  "Phone",
  "Address 1",
  "Address 2",
  "City",
  "State",
  "ZIP Code",
  "Web Site",
  "Industry",
];

function workbookBytes(
  rows: Array<Array<string | number | null>>,
  bookType: "biff8" | "xlsx" = "biff8",
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([headers, ...rows]),
    "CompanyList",
  );
  return XLSX.write(workbook, { bookType, type: "array" }) as ArrayBuffer;
}

describe("parseLeadWorkbook", () => {
  it("parses a legacy .xls CompanyList with exact source row numbers", async () => {
    const result = await parseLeadWorkbook(
      workbookBytes([
        ["Aspen Filmfest", "970-555-0100", null, null, "Aspen", "CO", 81611, "aspenfilm.org", "Festival"],
        ["Alamosa ARTs Festival", null, "401 Hunt Ave", null, "Alamosa", "CO", 81101, "alamosaarts.org", "Arts"],
      ]),
      "Sept Week 3.xls",
    );

    expect(result.rows).toEqual([
      expect.objectContaining({
        sheetName: "CompanyList",
        rowNumber: 2,
        company: "Aspen Filmfest",
        phone: "970-555-0100",
        city: "Aspen",
        state: "CO",
        zipCode: "81611",
        website: "aspenfilm.org",
      }),
      expect.objectContaining({
        sheetName: "CompanyList",
        rowNumber: 3,
        company: "Alamosa ARTs Festival",
        phone: null,
        address2: null,
      }),
    ]);
    expect(result.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts normalized header spelling in .xlsx files", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        [" company ", "PHONE", "Address1", "City", "State", "Zip", "Website", "Industry"],
        ["Test Fair", "", "1 Main", "Testville", "UT", "84001", "https://example.org", "Fair"],
      ]),
      "Leads",
    );
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    const result = await parseLeadWorkbook(bytes, "leads.xlsx");

    expect(result.rows[0]).toEqual(expect.objectContaining({
      company: "Test Fair",
      phone: null,
      address1: "1 Main",
      zipCode: "84001",
      website: "https://example.org",
    }));
  });

  it("preserves a row with no company and warns instead of silently dropping it", async () => {
    const result = await parseLeadWorkbook(
      workbookBytes([[null, "435-555-0100", null, null, "Moab", "UT", 84532, "example.org", "Festival"]]),
      "missing-name.xls",
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].company).toBe("");
    expect(result.warnings).toContain("CompanyList row 2: Company is missing.");
  });

  it("rejects workbooks that do not contain the required Company column", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["Unrelated", "Values"], ["A", "B"]]),
      "Sheet1",
    );
    const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;

    await expect(parseLeadWorkbook(bytes, "wrong.xlsx")).rejects.toThrow(
      "The workbook does not contain a Company column.",
    );
  });
});
