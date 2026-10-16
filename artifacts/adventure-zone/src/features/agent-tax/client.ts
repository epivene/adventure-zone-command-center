import { apiFetch } from "@/lib/auth-token";

export type EntryType = "income" | "expense" | "document";
export type Category = "commission" | "travel" | "supplies" | "fees" | "tax_form" | "other";
export type PaymentMethod = "venmo" | "cash" | "bank" | "check" | "card" | "other";

export interface TaxRecord {
  id: string; title: string; entryType: EntryType; amountCents: number | null;
  recordDate: string | null; taxYear: number; category: Category; paymentMethod: PaymentMethod;
  counterparty: string | null; notes: string | null; bookingId: string | null; bookingLabel: string | null;
  fileName: string | null; fileMime: string | null; fileSize: number | null;
  revision: number; createdAt: string; updatedAt: string;
}
export interface TaxRecordInput {
  title: string; entryType: EntryType; amountCents: number | null; recordDate: string | null; taxYear: number;
  category: Category; paymentMethod: PaymentMethod; counterparty: string | null; notes: string | null; bookingId: string | null;
}
export interface RecordsResponse {
  records: TaxRecord[]; total: number; years: number[];
  summary: { incomeCents: number; expenseCents: number; netCents: number; recordCount: number };
  storageAvailable: boolean;
}

export const CATEGORIES: Category[] = ["commission", "travel", "supplies", "fees", "tax_form", "other"];
export const METHODS: PaymentMethod[] = ["venmo", "cash", "bank", "check", "card", "other"];
export const ENTRY_TYPES: EntryType[] = ["income", "expense", "document"];
export const MAX_FILE_BYTES = 15 * 1024 * 1024;
export const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

export function labelOf(v: string): string {
  if (v === "tax_form") return "1099 / tax document";
  const s = v.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function ensureOk(res: Response): Promise<Response> {
  if (res.ok) return res;
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
}
async function json<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await ensureOk(await apiFetch(`/admin/agent-tax${path}`, init));
  return res.json() as Promise<T>;
}

/** Parse a USD string to integer cents. Returns null when invalid. */
export function parseMoneyToCents(value: string): number | null {
  const v = value.trim().replace(/^\$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [d, c = ""] = v.split(".");
  const cents = Number(d) * 100 + Number(c.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}
export function formatCents(cents: number | null): string {
  if (cents === null) return "";
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}
export function centsToInput(cents: number | null): string {
  return cents === null ? "" : (cents / 100).toFixed(2);
}

export function listRecords(p: { year: number | null; q: string; page: number; limit: number }) {
  const qs = new URLSearchParams();
  if (p.year) qs.set("year", String(p.year));
  qs.set("q", p.q); qs.set("page", String(p.page)); qs.set("limit", String(p.limit));
  return json<RecordsResponse>(`/records?${qs}`);
}
export function searchBookings(q: string) {
  return json<{ bookings: { id: string; label: string }[] }>(`/bookings?q=${encodeURIComponent(q)}`);
}
export async function createRecord(input: TaxRecordInput) {
  return (await json<{ record: TaxRecord }>("/records", { method: "POST", body: JSON.stringify(input) })).record;
}
export async function updateRecord(id: string, input: TaxRecordInput, expectedRevision: number) {
  return (await json<{ record: TaxRecord }>(`/records/${id}`, { method: "PATCH", body: JSON.stringify({ ...input, expectedRevision }) })).record;
}
export function deleteRecord(id: string, expectedRevision: number) {
  return json<{ ok: true }>(`/records/${id}`, { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE", expectedRevision }) });
}
export async function uploadFile(id: string, file: File, revision: number) {
  const res = await ensureOk(await apiFetch(`/admin/agent-tax/records/${id}/file`, {
    method: "PUT", body: file,
    headers: { "Content-Type": file.type, "x-file-name": encodeURIComponent(file.name), "x-record-revision": String(revision) },
  }));
  return ((await res.json()) as { record: TaxRecord }).record;
}
export async function removeFile(id: string, expectedRevision: number) {
  return (await json<{ record: TaxRecord }>(`/records/${id}/file`, { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE", expectedRevision }) })).record;
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadFile(rec: TaxRecord) {
  const res = await ensureOk(await apiFetch(`/admin/agent-tax/records/${rec.id}/file`));
  saveBlob(await res.blob(), rec.fileName ?? "receipt");
}
export async function viewFile(rec: TaxRecord) {
  const res = await ensureOk(await apiFetch(`/admin/agent-tax/records/${rec.id}/file`));
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export async function exportCsv(year: number) {
  const res = await ensureOk(await apiFetch(`/admin/agent-tax/export?year=${year}`));
  saveBlob(await res.blob(), `tax-records-${year}.csv`);
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "This entry was changed elsewhere. Reload the latest version before saving; nothing was overwritten, and your edits are still on screen.";
    if (e.status === 503) return "File storage is unavailable right now. Try again later.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}
