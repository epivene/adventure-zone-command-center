import { z } from "zod";

export const taxEntryInput = z.object({
  title: z.string().trim().min(1).max(200),
  entryType: z.enum(["income", "expense", "document"]),
  amountCents: z.number().int().min(0).max(1_000_000_000).nullable(),
  recordDate: z.string().date().nullable(),
  taxYear: z.number().int().min(1900).max(2200),
  category: z.enum(["commission", "travel", "supplies", "fees", "tax_form", "other"]),
  paymentMethod: z.enum(["venmo", "cash", "bank", "check", "card", "other"]),
  counterparty: z.string().trim().max(250).nullable(),
  notes: z.string().trim().max(5000).nullable(),
  bookingId: z.string().uuid().nullable(),
}).strict();

export const validTaxEntry = (value: z.infer<typeof taxEntryInput>) =>
  (value.entryType === "document" || (value.amountCents !== null && value.recordDate !== null)) &&
  (value.recordDate === null || Number(value.recordDate.slice(0, 4)) === value.taxYear);

export const createTaxEntry = taxEntryInput.refine(validTaxEntry, "Income/expenses need an amount and date; the date must match the tax year.");
export const updateTaxEntry = taxEntryInput.extend({ expectedRevision: z.number().int().positive() })
  .refine(validTaxEntry, "Income/expenses need an amount and date; the date must match the tax year.");
export const deleteTaxEntry = z.object({ confirmation: z.literal("DELETE"), expectedRevision: z.number().int().positive() }).strict();
export type TaxEntryInput = z.infer<typeof taxEntryInput>;
export class TaxError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function taxFileType(bytes: Uint8Array, mime: string) {
  const head = Buffer.from(bytes.subarray(0, 16));
  if (mime === "application/pdf" && head.subarray(0, 5).toString() === "%PDF-") return ".pdf";
  if (mime === "image/png" && head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return ".png";
  if (mime === "image/jpeg" && head[0] === 255 && head[1] === 216 && head[2] === 255) return ".jpg";
  if (mime === "image/webp" && head.subarray(0, 4).toString() === "RIFF" && head.subarray(8, 12).toString() === "WEBP") return ".webp";
  throw new TaxError(400, "Choose a PDF, JPEG, PNG, or WebP file whose contents match its file type.");
}

export function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  // Quoting alone does not stop spreadsheet formula injection.
  if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
