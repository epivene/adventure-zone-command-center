import { Readable, type Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import ZipStream from "zip-stream";
import type { PrivateObjectStorage } from "@/lib/private-object-storage";
import { csvCell, TaxError } from "./model";

export const ACCOUNTANT_NOTICE = "These records and receipts are not proof of deductibility. Your tax preparer must review business purpose, eligibility, completeness and applicable tax rules. Recorded expenses are not automatically tax deductions.";
export const MAX_PACKAGE_RECORDS = 10_000;
const MAX_RECEIPT_BYTES = 15 * 1024 * 1024;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const extensions: Record<string, string> = {
  "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
};

// Explicit projection: never serialize raw database rows, storage keys or planning settings.
export type PackageRecord = {
  id: string; tax_year: number; date_text: string | null; entry_type: string;
  title: string; category: string; amount_cents: string | number | null;
  payment_method: string; counterparty: string | null; notes: string | null;
  booking_id: string | null; booking_label: string | null; revision: number;
  storage_key: string | null; file_name: string | null; file_mime: string | null; file_size: number | null;
};

export function receiptPath(row: PackageRecord): string | null {
  if (!row.storage_key) return null;
  // Keys must belong to this personal record, never a shared bucket path or URL.
  if (!new RegExp(`^${uuid}$`, "i").test(row.id) ||
      !new RegExp(`^agent-tax/${row.id}/${uuid}$`, "i").test(row.storage_key) ||
      !extensions[row.file_mime ?? ""] || !row.file_size ||
      row.file_size < 0 || row.file_size > MAX_RECEIPT_BYTES) {
    throw new TaxError(503, "A receipt has invalid private-file metadata. Review its attachment before exporting.");
  }
  // Original filenames are metadata only, never ZIP paths (traversal, collisions, device names).
  return `receipts/${row.id}.${extensions[row.file_mime!]}`;
}

function csvLine(cells: unknown[]) {
  return cells.map(csvCell).join(",") + "\r\n";
}

export function* incomeExpenseCsv(rows: PackageRecord[]) {
  yield "\uFEFF" + csvLine(["Record ID", "Tax year", "Date", "Type", "Title", "Category", "Amount (USD)",
    "Payment method", "Paid by / paid to", "Booking", "Notes", "Receipt path"]);
  for (const r of rows) {
    if (r.entry_type !== "income" && r.entry_type !== "expense") continue;
    yield csvLine([r.id, r.tax_year, r.date_text, r.entry_type, r.title, r.category,
      r.amount_cents === null ? "" : (Number(r.amount_cents) / 100).toFixed(2),
      r.payment_method, r.counterparty, r.booking_label, r.notes, receiptPath(r)]);
  }
}

function* manifest(rows: PackageRecord[], year: number) {
  yield JSON.stringify({
    taxYear: year, createdAt: new Date().toISOString(), notice: ACCOUNTANT_NOTICE,
    scope: "Owner personal booking-agent records only. Includes document attachments. Excludes company/crew files, unpaid earnings and tax-estimate settings.",
    files: { "income-expenses.csv": "All income and expense records; Record ID links to records below.",
      "manifest.json": "Record-to-receipt mapping; null receiptPath means no attachment saved.",
      "README.txt": "Scope and limitations." },
  }).slice(0, -1) + ',"records":[';
  for (const [index, r] of rows.entries()) {
    yield (index ? "," : "") + JSON.stringify({
      recordId: r.id, revision: r.revision, taxYear: Number(r.tax_year), date: r.date_text,
      type: r.entry_type, title: r.title, category: r.category,
      amountCents: r.amount_cents === null ? null : Number(r.amount_cents),
      bookingId: r.booking_id, receiptPath: receiptPath(r),
      originalFilename: r.file_name, mimeType: r.file_mime, sizeBytes: r.file_size,
      receiptStatus: r.storage_key ? "included" : "no_attachment",
    });
  }
  yield "]}\n";
}

/** One receipt at a time, with backpressure all the way to private storage. */
export async function writeAccountantPackage(rows: PackageRecord[], year: number, storage: PrivateObjectStorage, destination: Writable) {
  const zip = new ZipStream({ zlib: { level: 1 }, forceZip64: true });
  let current: Readable | undefined;
  const stop = () => { current?.destroy(); zip.destroy(); };
  destination.once("close", stop);
  // Observe pipeline rejection immediately, including a disconnected/slow client.
  const output = pipeline(zip, destination);
  void output.catch(() => { current?.destroy(); });
  const entry = (source: string | Readable, name: string) => new Promise<void>((resolve, reject) => {
    const fail = (error: Error) => { cleanup(); reject(error); };
    const cleanup = () => { zip.off("error", fail); zip.off("close", closed); };
    const closed = () => fail(new Error("Accountant export interrupted"));
    zip.once("error", fail);
    zip.once("close", closed);
    zip.entry(source, { name }, (error) => { cleanup(); error ? reject(error) : resolve(); });
  });
  try {
    await entry(`Tax year ${year}\n\n${ACCOUNTANT_NOTICE}\n\n` +
      "Includes all personal booking-agent records for this tax year, regardless of current search/page. " +
      "income-expenses.csv contains received income and recorded expenses, not unpaid earnings. " +
      "manifest.json links every attachment (including document-only records) to its record ID and revision. " +
      "No attachment means none was saved, not proof that a receipt is unnecessary. " +
      "Shared company/crew files and tax-estimate assumptions are excluded. " +
      "This package contains private financial information. Share it securely.\n", "README.txt");
    await entry(Readable.from(incomeExpenseCsv(rows)), "income-expenses.csv");
    for (const row of rows) {
      const path = receiptPath(row);
      if (!path) continue;
      // No buffered get() fallback: exports must stay bounded even with large/corrupt objects.
      current = storage.openReadStream!(row.storage_key!);
      const source = current;
      const bounded = Readable.from((async function* () {
        let bytes = 0;
        try {
          for await (const chunk of source) {
            bytes += Buffer.byteLength(chunk);
            if (bytes > MAX_RECEIPT_BYTES || bytes > Number(row.file_size)) throw new Error("Receipt size mismatch");
            yield chunk;
          }
          if (bytes !== Number(row.file_size)) throw new Error("Receipt size mismatch");
        } finally { source.destroy(); }
      })());
      await entry(bounded, path);
      current = undefined;
    }
    // Write mapping last, only after every promised attachment was successfully read.
    await entry(Readable.from(manifest(rows, year)), "manifest.json");
    zip.finalize();
    await output;
  } catch (error) {
    current?.destroy();
    zip.destroy(error instanceof Error ? error : new Error("Accountant export failed"));
    await output.catch(() => undefined);
    throw error;
  } finally {
    destination.off("close", stop);
  }
}
