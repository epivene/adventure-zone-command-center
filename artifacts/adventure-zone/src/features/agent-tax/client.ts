import { apiFetch } from "@/lib/auth-token";
import type {
  AgentTaxRecord, AgentTaxInput, ListAgentTaxRecords200,
  AgentPayItem, AgentPayPayment, AgentPayInput, AgentPayPaymentInput, ListAgentPay200,
  AgentEstimateSettings, AgentEstimate, AgentEstimateResponse,
} from "@workspace/api-client-react";

export type EntryType = "income" | "expense" | "document";
export type Category = "commission" | "travel" | "supplies" | "fees" | "tax_form" | "other";
export type PaymentMethod = "venmo" | "cash" | "bank" | "check" | "card" | "other";

export type TaxRecord = AgentTaxRecord;
export type TaxRecordInput = AgentTaxInput;
export type RecordsResponse = ListAgentTaxRecords200;

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

export const MAX_CENTS = 1_000_000_000;
/** Parse a USD string to integer cents. Returns null when invalid. Signed only where the contract allows it. */
export function parseMoneyToCents(value: string, signed = false): number | null {
  let v = value.trim().replace(/^(-?)\$/, "$1");
  let neg = false;
  if (signed && v.startsWith("-")) { neg = true; v = v.slice(1); }
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [d, c = ""] = v.split(".");
  const cents = Number(d) * 100 + Number(c.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return neg ? -cents : cents;
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
  // Open the tab synchronously so popup blockers allow it; blob URL is never persisted.
  const tab = window.open("", "_blank");
  try {
    const res = await ensureOk(await apiFetch(`/admin/agent-tax/records/${rec.id}/file`));
    const url = URL.createObjectURL(await res.blob());
    if (tab) { tab.location.href = url; } else { window.location.assign(url); }
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (e) { tab?.close(); throw e; }
}
export async function exportCsv(year: number) {
  const res = await ensureOk(await apiFetch(`/admin/agent-tax/export?year=${year}`));
  saveBlob(await res.blob(), `tax-records-${year}.csv`);
}

export function describeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 409) return "This entry was changed elsewhere. Reload the latest version before saving; nothing was overwritten, and your edits are still on screen.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

// ---- Pay owed to me ----
export type PayPayment = AgentPayPayment;
export type PayItem = AgentPayItem;
export type PayResponse = ListAgentPay200;
export type PayInput = AgentPayInput;
export const WEEKLY_TITLE = "Weekly booking-agent pay";
export const WEEKLY_CENTS = 60000;

export const listPay = (page: number, limit: number) => json<PayResponse>(`/pay?page=${page}&limit=${limit}`);
export async function createPay(input: PayInput) {
  return (await json<{ item: PayItem }>("/pay", { method: "POST", body: JSON.stringify(input) })).item;
}
export async function updatePay(id: string, input: PayInput, expectedRevision: number) {
  return (await json<{ item: PayItem }>(`/pay/${id}`, { method: "PATCH", body: JSON.stringify({ ...input, expectedRevision }) })).item;
}
export const deletePay = (id: string, expectedRevision: number) =>
  json<{ ok: true }>(`/pay/${id}`, { method: "DELETE", body: JSON.stringify({ confirmation: "DELETE", expectedRevision }) });
export type PaymentInput = Omit<AgentPayPaymentInput,"expectedRevision"|"paymentRequestId">;
export async function recordPayment(id: string, input: PaymentInput, expectedRevision: number, paymentRequestId: string) {
  return json<{ item: PayItem; recordId: string }>(`/pay/${id}/payments`, {
    method: "POST", body: JSON.stringify({ ...input, expectedRevision, paymentRequestId }),
  });
}
export async function exportPayCsv() {
  const res = await ensureOk(await apiFetch("/admin/agent-tax/pay/export"));
  saveBlob(await res.blob(), "pay-owed.csv");
}

// ---- Tax planning estimate ----
export type FilingStatus = AgentEstimateSettings["filingStatus"];
export const FILING_STATUSES: FilingStatus[] = ["single", "married_joint", "married_separate", "head_household"];
export type EstimateSettings = AgentEstimateSettings;
export type Estimate = AgentEstimate;
export type EstimateResponse = AgentEstimateResponse;
export const getEstimate = (year: number) => json<EstimateResponse>(`/estimate/${year}`);
export const saveEstimate = (year: number, expectedRevision: number, settings: EstimateSettings) =>
  json<EstimateResponse>(`/estimate/${year}`, { method: "PUT", body: JSON.stringify({ expectedRevision, settings }) });
