export type LeadSourceRow = {
  sheetName: string;
  rowNumber: number;
  company: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  website: string | null;
  industry: string | null;
  originalValues: Record<string, string | null>;
};

export type ParsedLeadWorkbook = {
  fileName: string;
  fileSha256: string;
  rows: LeadSourceRow[];
  warnings: string[];
};

export async function parseLeadWorkbook(
  bytes: ArrayBuffer | Uint8Array,
  fileName: string,
): Promise<ParsedLeadWorkbook> {
  if (!/\.xlsx?$/i.test(fileName)) {
    throw new Error("Choose an Excel .xls or .xlsx file.");
  }
  const byteView = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (byteView.byteLength === 0) throw new Error("The selected workbook is empty.");
  if (byteView.byteLength > 10 * 1024 * 1024) {
    throw new Error("The selected workbook is larger than 10 MB.");
  }

  const workbook = XLSX.read(byteView, { type: "array", cellDates: false });
  const rows: LeadSourceRow[] = [];
  const warnings: string[] = [];
  let recognizedSheet = false;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const values = XLSX.utils.sheet_to_json<Array<string | number | boolean | null>>(
      sheet,
      { header: 1, raw: false, defval: null, blankrows: true },
    );
    const headerIndex = values.findIndex((row) =>
      row.some((value) => normalizedHeader(value) === "company"),
    );
    if (headerIndex < 0) continue;
    recognizedSheet = true;
    const headers = values[headerIndex].map((value) => cellText(value));
    const mapped = headers.map(headerKey);

    for (let index = headerIndex + 1; index < values.length; index += 1) {
      const source = values[index] ?? [];
      if (source.every((value) => cellText(value) === "")) continue;
      if (rows.length >= 5_000) {
        throw new Error("The workbook contains more than 5,000 event rows.");
      }
      const originalValues: Record<string, string | null> = {};
      const selected: Partial<Record<LeadField, string | null>> = {};
      headers.forEach((header, columnIndex) => {
        if (!header) return;
        const value = limitedCellText(source[columnIndex]);
        originalValues[header] = value || null;
        const key = mapped[columnIndex];
        if (key && selected[key] == null) selected[key] = value || null;
      });
      const rowNumber = index + 1;
      const company = selected.company ?? "";
      if (!company) warnings.push(`${sheetName} row ${rowNumber}: Company is missing.`);
      rows.push({
        sheetName,
        rowNumber,
        company,
        phone: selected.phone ?? null,
        address1: selected.address1 ?? null,
        address2: selected.address2 ?? null,
        city: selected.city ?? null,
        state: selected.state ?? null,
        zipCode: selected.zipCode ?? null,
        website: selected.website ?? null,
        industry: selected.industry ?? null,
        originalValues,
      });
    }
  }

  if (!recognizedSheet) {
    throw new Error("The workbook does not contain a Company column.");
  }
  if (rows.length === 0) throw new Error("The workbook does not contain any event rows.");

  const digestInput = new Uint8Array(byteView.byteLength);
  digestInput.set(byteView);
  const digest = await crypto.subtle.digest("SHA-256", digestInput);
  const fileSha256 = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");

  return { fileName, fileSha256, rows, warnings };
}

type LeadField = Exclude<keyof LeadSourceRow, "sheetName" | "rowNumber" | "originalValues">;

function normalizedHeader(value: unknown): string {
  return cellText(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function headerKey(value: unknown): LeadField | null {
  const key = normalizedHeader(value);
  const aliases: Record<string, LeadField> = {
    company: "company",
    companyname: "company",
    phone: "phone",
    phonenumber: "phone",
    address1: "address1",
    addressline1: "address1",
    address2: "address2",
    addressline2: "address2",
    city: "city",
    state: "state",
    region: "state",
    zip: "zipCode",
    zipcode: "zipCode",
    postalcode: "zipCode",
    website: "website",
    web: "website",
    url: "website",
    industry: "industry",
  };
  return aliases[key] ?? null;
}

function cellText(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function limitedCellText(value: unknown): string {
  const text = cellText(value);
  if (text.length > 10_000) throw new Error("A spreadsheet cell is larger than 10,000 characters.");
  return text;
}
import * as XLSX from "xlsx";
