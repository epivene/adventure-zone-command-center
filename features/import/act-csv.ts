import type { ActCsvRecord } from "@/features/import/act-types";

const headerAliases = new Map<string, keyof Omit<ActCsvRecord, "rowNumber" | "validationErrors">>([
  ["record id", "recordId"],
  ["recordid", "recordId"],
  ["act record id", "recordId"],
  ["company", "company"],
  ["organization", "company"],
  ["contact", "contact"],
  ["contact name", "contact"],
  ["email", "email"],
  ["email address", "email"],
  ["phone", "phone"],
  ["phone number", "phone"],
  ["city", "city"],
  ["state", "region"],
  ["region", "region"],
]);

type ParsedLine =
  | { ok: true; values: string[] }
  | { ok: false; values: string[]; message: string };

function parseLine(line: string): ParsedLine {
  const values: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }

  values.push(value.trim());
  if (quoted) {
    return {
      ok: false,
      values,
      message: "Row contains an unclosed quoted value.",
    };
  }

  return { ok: true, values };
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function nullable(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export function parseActCsv(csv: string): ActCsvRecord[] {
  const lines = csv.replace(/\r\n?/g, "\n").split("\n");
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex < 0) return [];

  const header = parseLine(lines[headerIndex] ?? "");
  if (!header.ok) {
    throw new Error("The CSV header contains an unclosed quoted value.");
  }

  const fieldIndexes = new Map<
    keyof Omit<ActCsvRecord, "rowNumber" | "validationErrors">,
    number
  >();
  header.values.forEach((value, index) => {
    const field = headerAliases.get(normalizeHeader(value));
    if (field !== undefined && !fieldIndexes.has(field)) {
      fieldIndexes.set(field, index);
    }
  });

  const contactIndex = fieldIndexes.get("contact");
  if (contactIndex === undefined) {
    throw new Error('The CSV must include a "Contact" column.');
  }

  const records: ActCsvRecord[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().replace(/,/g, "").length === 0) continue;

    const parsed = parseLine(line);
    const get = (
      field: keyof Omit<ActCsvRecord, "rowNumber" | "validationErrors">,
    ) => {
      const fieldIndex = fieldIndexes.get(field);
      return fieldIndex === undefined ? undefined : parsed.values[fieldIndex];
    };
    const contact = nullable(get("contact")) ?? "";
    const validationErrors: string[] = [];
    if (!parsed.ok) validationErrors.push(parsed.message);
    if (parsed.ok && parsed.values.length !== header.values.length) {
      validationErrors.push(
        `Row has ${parsed.values.length} columns; expected ${header.values.length}.`,
      );
    }
    if (contact.length === 0 && parsed.ok) {
      validationErrors.push("Contact is required.");
    }

    records.push({
      rowNumber: index + 1,
      recordId: nullable(get("recordId")),
      company: nullable(get("company")),
      contact,
      email: nullable(get("email")),
      phone: nullable(get("phone")),
      city: nullable(get("city")),
      region: nullable(get("region")),
      validationErrors,
    });
  }

  return records;
}
