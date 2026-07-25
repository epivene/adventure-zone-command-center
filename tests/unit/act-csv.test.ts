import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseActCsv } from "@/features/import/act-csv";

describe("parseActCsv", () => {
  it("normalizes Act header spelling and ignores blank rows", async () => {
    const fixture = await readFile(
      new URL("../fixtures/act-contacts.csv", import.meta.url),
      "utf8",
    );
    const records = parseActCsv(`\uFEFF${fixture}\n,\n`);

    expect(records).toHaveLength(3);
    expect(records[0]).toEqual({
      rowNumber: 2,
      recordId: "ACT-001",
      company: "Marias Fair",
      contact: "Avery Example",
      email: "avery@example.com",
      phone: "406-555-0101",
      city: "Shelby",
      region: "MT",
      validationErrors: [],
    });
  });

  it("parses quoted commas and escaped quotes without changing the value", () => {
    const [record] = parseActCsv(
      [
        " record id , company , contact , EMAIL , phone , city , STATE ",
        'ACT-9,"Fair, County","Avery ""Ace"" Example",AVERY@EXAMPLE.COM,,Shelby,MT',
      ].join("\n"),
    );

    expect(record).toMatchObject({
      company: "Fair, County",
      contact: 'Avery "Ace" Example',
      email: "AVERY@EXAMPLE.COM",
      region: "MT",
      validationErrors: [],
    });
  });

  it("returns malformed rows as reviewable errors and continues parsing later rows", () => {
    const records = parseActCsv(
      [
        "Record ID,Company,Contact,Email,Phone,City,State",
        "ACT-1,Missing Contact,,missing@example.com,,,MT",
        'ACT-2,"Broken quote,Casey Example,casey@example.com,,,WY',
        "ACT-3,Valid Fair,Jordan Example,jordan@example.com,,,ND",
      ].join("\n"),
    );

    expect(records).toHaveLength(3);
    expect(records[0]?.validationErrors).toContain("Contact is required.");
    expect(records[1]).toMatchObject({
      rowNumber: 3,
      validationErrors: ["Row contains an unclosed quoted value."],
    });
    expect(records[2]).toMatchObject({
      rowNumber: 4,
      recordId: "ACT-3",
      contact: "Jordan Example",
      validationErrors: [],
    });
  });
});
