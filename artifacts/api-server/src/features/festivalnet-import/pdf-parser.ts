import { createHash } from "node:crypto";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { FestivalNetDraft } from "@workspace/api-zod";

type TextItem = { str: string; transform: number[]; width: number; height: number };
type Link = { url: string; label: string };
type Line = { text: string; y: number };

const fieldLabels = [
  "Event Address", "Event Type", "Inside or Out", "Attendance #", "# of Years",
  "Show Promoter", "Main Email", "Show Director", "Exhibit Director", "Food Director",
  "Entertainment", "Ph.", "E", "Web", "# Exhibitors", "Juried", "Booth Fees",
  "Deadline", "Apply/Jury fee", "Prize Money", "What is allowed", "Handmade %",
  "How/Where apply", "Insurance", "Food Booths", "Food Booth Fees", "# of Stages",
  "Other Activities", "Admission", "Description",
];
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const labelsPattern = fieldLabels.map(escape).sort((a, b) => b.length - a.length).join("|");
const labelRegex = new RegExp(`(${labelsPattern})\\s*:`, "gi");
const blank = (value: string) => /^(?:n\/?a|not available|unknown|—|-)?$/i.test(value.trim());
const clean = (value: string) => value.replace(/\s+/g, " ").trim();
const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function ensurePromiseResolvers() {
  // The server's Node 20 runtime lacks this standard API used by PDF.js.
  const constructor = Promise as PromiseConstructor & {
    withResolvers?: <T>() => { promise: Promise<T>; resolve(value: T | PromiseLike<T>): void; reject(reason?: unknown): void };
  };
  if (!constructor.withResolvers) {
    Object.defineProperty(constructor, "withResolvers", {
      configurable: true, writable: true,
      value: function<T>(this: PromiseConstructor) {
        let resolve!: (value: T | PromiseLike<T>) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new this<T>((yes, no) => { resolve = yes; reject = no; });
        return { promise, resolve, reject };
      },
    });
  }
}

function explicitCalendarDate(value: string): string | null {
  let match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  let month: number; let day: number; let year: number;
  if (match) { month = Number(match[1]); day = Number(match[2]); year = Number(match[3]); }
  else {
    match = value.match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
    if (!match) return null;
    month = months.findIndex(name => name.startsWith(match![1].toLowerCase())) + 1;
    day = Number(match[2]); year = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (month < 1 || month > 12 || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function linesFromItems(items: TextItem[]): Line[] {
  const rows: { y: number; items: TextItem[] }[] = [];
  for (const item of items.filter(item => item.str.trim())) {
    let row = rows.find(row => Math.abs(row.y - item.transform[5]) < 3);
    if (!row) { row = { y: item.transform[5], items: [] }; rows.push(row); }
    row.items.push(item);
  }
  return rows.sort((a, b) => b.y - a.y).map(row => ({
    y: row.y, text: clean(row.items.sort((a, b) => a.transform[4] - b.transform[4]).map(item => item.str).join(" ")),
  }));
}

export function parseFestivalNetLines(lines: string[], links: Link[], filename: string): { draft: FestivalNetDraft; warnings: string[] } {
  const text = lines.join("\n");
  const sources = [...text.matchAll(/https:\/\/(?:www\.)?festivalnet\.com\/(\d+)\/[^\s]+/gi)];
  if (!sources.length) throw new Error("This PDF does not contain a FestivalNet event link. Upload an event's printable profile.");
  if (new Set(sources.map(match => match[1])).size > 1) throw new Error("This PDF contains more than one event. Upload one festival profile at a time.");
  const sourceUrl = sources[0][0].replace(/[),.;]+$/, "");
  const warnings: string[] = [];
  const fieldValues: Record<string, string[]> = {};
  let lastKey: string | null = null;
  for (const line of lines) {
    const matches = [...line.matchAll(labelRegex)];
    if (!matches.length) {
      // Only long paragraphs continue over unlabelled lines. Never absorb headings/footer.
      if (lastKey && ["description", "other activities"].includes(lastKey) &&
          !/^(?:https?:|Exhibit Booths|Food Booths|Music \/|.*\d+\/\d+\s*$)/i.test(line)) {
        const values = fieldValues[lastKey];
        values[values.length - 1] += ` ${line}`;
      }
      continue;
    }
    matches.forEach((match, index) => {
      const key = match[1].toLowerCase();
      const value = clean(line.slice(match.index! + match[0].length, matches[index + 1]?.index ?? line.length));
      (fieldValues[key] ??= []).push(value);
      lastKey = key;
    });
  }
  const read = (key: string) => {
    const value = clean(fieldValues[key.toLowerCase()]?.find(value => !blank(value)) ?? "");
    if (/[.…]{1,3}$/.test(value)) {
      warnings.push(`${key} appears shortened in the PDF; check it before saving.`);
    }
    return blank(value) ? "" : value;
  };
  const monthPattern = months.join("|");
  const dateMatch = text.match(new RegExp(`\\b(${monthPattern})\\s+(\\d{1,2})(?:\\s*[-–]\\s*(?:(${monthPattern})\\s+)?(\\d{1,2}))?\\s*,\\s*(20\\d{2}|19\\d{2}|21\\d{2})\\b`, "i"));
  if (!dateMatch) throw new Error("The event dates could not be identified. Upload the full printable FestivalNet event profile, including its dates.");
  const year = Number(dateMatch[5]);
  const date = (month: string, day: string) => `${year}-${String(months.indexOf(month.toLowerCase()) + 1).padStart(2, "0")}-${day.padStart(2, "0")}`;
  const startsOn = date(dateMatch[1], dateMatch[2]);
  const endsOn = date(dateMatch[3] || dateMatch[1], dateMatch[4] || dateMatch[2]);
  // The heading immediately before Status is preferable to browser-print headers.
  const statusIndex = lines.findIndex(line => /Status:\s*Updated/i.test(line));
  let name = statusIndex > 0 ? lines[statusIndex - 1] : "";
  name = name.replace(/\s+Show Rating:.*$/i, "").trim();
  if (!name || /festivalnet\.com|^\d+\/\d+\/\d+|an? .* in /i.test(name)) {
    const heading = lines.find(line => line.includes("Status:"));
    name = heading?.split(/Status:/i)[0].replace(/\s+Show Rating:.*$/i, "").trim() ?? "";
  }
  if (!name) throw new Error("The festival name could not be identified. Upload the complete printable event profile.");
  const venueLine = lines.find(line => /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(line) && !/Event Address:/i.test(line)) ?? "";
  const location = venueLine.match(/^(.*),\s*([^,]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/);
  const director = read("Show Director");
  const directorLine = lines.find(line => /Show Director:/i.test(line)) ?? "";
  const contactPhone = directorLine.match(/Ph\.\s*:\s*([\d()+.\s-]+)/i)?.[1]?.trim() ?? "";
  const email = read("Main Email") || text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const applicationUrl = links.find(link => /how\/where apply|artis|register|application/i.test(link.label) &&
    /^https?:\/\//i.test(link.url) && !/festivalnet\.com/i.test(link.url))?.url;
  const websiteLabel = read("Web");
  const website = links.find(link => websiteLabel && link.label.includes(websiteLabel) && /^https?:\/\//i.test(link.url) &&
    !/festivalnet\.com/i.test(link.url))?.url;
  const details: Record<string, string> = { startsOn, endsOn };
  const mappings: Record<string, string> = {
    "Event Type": "category", "Inside or Out": "setting", "Attendance #": "attendance",
    "# of Years": "editionHistory", "Show Promoter": "promoter", "# Exhibitors": "exhibitors",
    Juried: "juried", "Booth Fees": "boothFee", "Apply/Jury fee": "applicationTerms",
    "Prize Money": "prizes", "What is allowed": "acceptedCategories", "Handmade %": "handmadePercent",
    Insurance: "insurance", "Food Booths": "foodVendors", "Food Booth Fees": "foodFees",
    "# of Stages": "stages", "Other Activities": "activities", Admission: "admission", Description: "description",
  };
  for (const [label, key] of Object.entries(mappings)) { const value = read(label); if (value) details[key] = value; }
  if (details.applicationTerms) details.applicationTerms = `Apply/jury fee: ${details.applicationTerms}`;
  if (email) details.mainEmail = email;
  if (applicationUrl) details.applicationUrl = applicationUrl;
  else if (read("How/Where apply")) warnings.push("The complete application URL was not found. Add it manually rather than using a shortened link.");
  const address = read("Event Address");
  details.venue = [location?.[1], address, location?.[2], location?.[3], location?.[4]].filter(Boolean).join(", ");
  const deadlines = fieldValues.deadline ?? [];
  for (const [index, key] of ["applicationDeadline", "foodDeadline", "performanceDeadline"].entries()) {
    if (deadlines[index] && !blank(deadlines[index])) {
      const parsed = explicitCalendarDate(clean(deadlines[index]));
      if (parsed) details[key] = parsed;
      else warnings.push(`Review ${key}: ${deadlines[index]}. It was not converted automatically.`);
    }
  }
  if (!location) warnings.push("City, state and ZIP were not recognized. Review the venue and location fields.");
  if (!director || blank(director)) warnings.push("No show director was listed; contact name is optional.");
  warnings.push("Only information present in the PDF is imported. Blank/NA values are omitted. Review shortened text and dates before saving.");
  return { draft: {
    name, year, sourceUrl, sourceFilename: filename,
    city: location?.[2]?.trim() ?? "", region: location?.[3] ?? "", postalCode: location?.[4] ?? "",
    address1: address, phone: contactPhone, website: website ?? "",
    contactName: blank(director) ? "" : director, contactEmail: email, contactPhone,
    details,
  }, warnings };
}

export async function parseFestivalNetPdf(bytes: Uint8Array, filename: string) {
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024 || Buffer.from(bytes.subarray(0, 5)).toString() !== "%PDF-") {
    throw new Error("Choose a valid PDF no larger than 10 MB.");
  }
  ensurePromiseResolvers();
  // PDF.js 6 removed eval support and its isEvalSupported option.
  const task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, disableFontFace: true });
  const timer = setTimeout(() => { void task.destroy(); }, 20_000);
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 12) throw new Error("Choose one event's PDF with no more than 12 pages.");
    const lines: string[] = [];
    const links: Link[] = [];
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      const items = content.items.filter((item): item is TextItem & typeof item => "str" in item);
      lines.push(...linesFromItems(items).map(line => line.text));
      for (const annotation of await page.getAnnotations()) {
        if (!annotation.url || !annotation.rect) continue;
        const [left, bottom, right, top] = annotation.rect;
        const label = clean(items.filter(item => {
          const x = item.transform[4]; const y = item.transform[5];
          return x + item.width >= left && x <= right && y >= bottom - 3 && y <= top + 3;
        }).map(item => item.str).join(" "));
        links.push({ url: annotation.url, label });
      }
    }
    if (lines.join("").length < 100) throw new Error("This PDF appears to be a scan. Save the FestivalNet printable page as a PDF with selectable text, then upload it.");
    if (lines.join("").length > 80_000) throw new Error("This PDF contains too much text. Upload one event profile.");
    const result = parseFestivalNetLines(lines, links, filename);
    result.draft.details.importFileSha256 = createHash("sha256").update(bytes).digest("hex");
    return result;
  } finally {
    clearTimeout(timer);
    await task.destroy();
  }
}
