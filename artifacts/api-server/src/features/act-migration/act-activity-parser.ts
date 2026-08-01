/**
 * Parser for Act! activity, note, and history items fetched during a route scan.
 * Normalises each raw API item into a flat shape suitable for keyword matching.
 */

export type ActStreamType = "activity" | "note" | "history";

export type ParsedActActivityItem = {
  streamType: ActStreamType;
  actId: string;
  date: string | null;
  subject: string | null;
  body: string | null;
  contactName: string | null;
  companyName: string | null;
  /** Concatenation of subject + body for keyword scanning */
  textBlob: string;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function firstStringInCollection(value: unknown, field: string): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      if (isRecord(item)) {
        const s = str(item[field]);
        if (s) return s;
      }
    }
    return null;
  }
  if (isRecord(value)) return str(value[field]);
  return null;
}

function extractContactName(raw: Record<string, unknown>): string | null {
  // Activities expand contacts as a collection; notes/history expand as singular contact
  const contacts = raw["contacts"];
  const contact = raw["contact"];
  if (contacts !== undefined) {
    return firstStringInCollection(contacts, "fullName");
  }
  if (isRecord(contact)) return str(contact["fullName"]);
  return null;
}

function extractCompanyName(raw: Record<string, unknown>): string | null {
  // Activities expand companies as a collection; notes/history expand as singular company
  const companies = raw["companies"];
  const company = raw["company"];
  if (companies !== undefined) {
    return firstStringInCollection(companies, "name");
  }
  if (isRecord(company)) return str(company["name"]);
  return null;
}

export function parseActivityItem(
  streamType: "activity",
  raw: Record<string, unknown>,
): ParsedActActivityItem | null {
  const actId = str(raw["id"]);
  if (!actId) return null;
  const subject = str(raw["subject"]);
  const body = str(raw["details"]);
  const date = str(raw["scheduleDate"]) ?? str(raw["edited"]);
  const contactName = extractContactName(raw);
  const companyName = extractCompanyName(raw);
  const textBlob = [subject, body].filter(Boolean).join(" ");
  return { streamType, actId, date, subject, body, contactName, companyName, textBlob };
}

export function parseNoteItem(
  streamType: "note",
  raw: Record<string, unknown>,
): ParsedActActivityItem | null {
  const actId = str(raw["id"]);
  if (!actId) return null;
  const subject = str(raw["subject"]);
  const body = str(raw["body"]);
  const date = str(raw["createDate"]) ?? str(raw["edited"]);
  const contactName = extractContactName(raw);
  const companyName = extractCompanyName(raw);
  const textBlob = [subject, body].filter(Boolean).join(" ");
  return { streamType, actId, date, subject, body, contactName, companyName, textBlob };
}

export function parseHistoryItem(
  streamType: "history",
  raw: Record<string, unknown>,
): ParsedActActivityItem | null {
  const actId = str(raw["id"]);
  if (!actId) return null;
  const subject = str(raw["subject"]);
  const body = str(raw["details"]);
  const date = str(raw["createDate"]) ?? str(raw["edited"]);
  const contactName = extractContactName(raw);
  const companyName = extractCompanyName(raw);
  const textBlob = [subject, body].filter(Boolean).join(" ");
  return { streamType, actId, date, subject, body, contactName, companyName, textBlob };
}

export function parseRawItem(
  streamType: ActStreamType,
  raw: unknown,
): ParsedActActivityItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  switch (streamType) {
    case "activity":
      return parseActivityItem("activity", record);
    case "note":
      return parseNoteItem("note", record);
    case "history":
      return parseHistoryItem("history", record);
  }
}
