import { apiFetch, apiGet, apiPatch, apiPost } from "@/lib/auth-token";
import type {
  PaperNoteBatchListItem,
  PaperNoteBatchPreflight,
  PaperNoteBatchView,
  PaperNoteImportSummary,
} from "./paper-note-types";
import type {
  PaperNoteMatch,
  PaperNoteReviewDraft,
  PaperNoteReviewEntryDetails,
} from "./paper-note-review-types";

async function errorMessage(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: string };
  return payload.error ?? `API ${response.status}`;
}

export async function createPaperNoteBatch(name: string | null) {
  return apiPost<{ batchId: string }>("/paper-notes/batches", { name });
}

export async function listPaperNoteBatches() {
  const result = await apiGet<{ batches: PaperNoteBatchListItem[] }>("/paper-notes/batches");
  return result.batches;
}

export async function getPaperNoteBatch(batchId: string) {
  const result = await apiGet<{ batch: PaperNoteBatchView }>(`/paper-notes/batches/${batchId}`);
  return result.batch;
}

export async function createPaperNotePage(input: {
  batchId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  return apiPost<{ pageId: string }>(`/paper-notes/batches/${input.batchId}/pages`, {
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  });
}

export async function uploadPaperNotePageImage(input: {
  batchId: string;
  pageId: string;
  file: File;
}) {
  const response = await apiFetch(
    `/paper-notes/batches/${input.batchId}/pages/${input.pageId}/image`,
    {
      method: "PUT",
      headers: { "Content-Type": input.file.type },
      body: input.file,
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<{ ok: true }>;
}

export function reorderPaperNotePages(batchId: string, orderedPageIds: string[]) {
  return apiPatch<{ ok: true }>(`/paper-notes/batches/${batchId}/pages`, { orderedPageIds });
}

export function rotatePaperNotePage(batchId: string, pageId: string, rotationDegrees: 0 | 90 | 180 | 270) {
  return apiPatch<{ ok: true }>(`/paper-notes/batches/${batchId}/pages`, {
    rotation: { pageId, rotationDegrees },
  });
}

export function rereadPaperNotePage(
  batchId: string,
  pageId: string,
  rotationDegrees: 0 | 90 | 180 | 270,
) {
  return apiPost<{ ok: true }>(
    `/paper-notes/batches/${batchId}/pages/${pageId}/re-read`,
    { rotationDegrees, confirmDiscardReview: true },
  );
}

export async function restorePaperNotePageSource(
  batchId: string,
  pageId: string,
  file: File,
) {
  const response = await apiFetch(
    `/paper-notes/batches/${batchId}/pages/${pageId}/source`,
    {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    },
  );
  if (!response.ok) throw new Error(await errorMessage(response));
  return response.json() as Promise<{ ok: true }>;
}

export async function deletePaperNotePage(batchId: string, pageId: string) {
  const response = await apiFetch(`/paper-notes/batches/${batchId}/pages/${pageId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export async function deletePaperNoteBatch(batchId: string) {
  const response = await apiFetch(`/paper-notes/batches/${batchId}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await errorMessage(response));
}

export function startPaperNoteExtraction(batchId: string) {
  return apiPost<{ ok: true }>(`/paper-notes/batches/${batchId}/extract`, {});
}

export function retryPaperNotePage(batchId: string, pageId: string) {
  return apiPost<{ ok: true }>(
    `/paper-notes/batches/${batchId}/pages/${pageId}/retry`,
    {},
  );
}

export function addManualPaperNoteEntry(
  batchId: string,
  pageId: string,
  transcription: string,
) {
  return apiPost<{ entryId: string }>(
    `/paper-notes/batches/${batchId}/pages/${pageId}/manual-entry`,
    { transcription },
  );
}

export function markPaperNotePageReviewedEmpty(batchId: string, pageId: string) {
  return apiPost<{ ok: true }>(
    `/paper-notes/batches/${batchId}/pages/${pageId}/reviewed-empty`,
    {},
  );
}

export function getPaperNotePageSource(
  batchId: string,
  pageId: string,
  kind: "original" | "analysis" = "original",
) {
  return apiGet<{ url: string; kind: "original" | "analysis" }>(
    `/paper-notes/batches/${batchId}/pages/${pageId}/source-url?kind=${kind}`,
  );
}

export function getPaperNoteEntrySource(
  entryId: string,
  kind: "original" | "analysis" = "original",
) {
  return apiGet<{ url: string; kind: "original" | "analysis" }>(
    `/paper-notes/entries/${entryId}/source-url?kind=${kind}`,
  );
}

export function getPaperNoteActivitySource(
  activityId: string,
  kind: "original" | "analysis" = "original",
) {
  return apiGet<{ url: string; kind: "original" | "analysis" }>(
    `/paper-notes/activities/${activityId}/source-url?kind=${kind}`,
  );
}

export async function getPaperNoteEntryReview(entryId: string) {
  const result = await apiGet<{ entry: PaperNoteReviewEntryDetails }>(
    `/paper-notes/entries/${entryId}/review`,
  );
  return result.entry;
}

export async function getPaperNoteEntryMatches(entryId: string) {
  const result = await apiGet<{ matches: PaperNoteMatch[] }>(
    `/paper-notes/entries/${entryId}/matches`,
  );
  return result.matches;
}

export async function searchPaperNoteProfiles(query: string) {
  const result = await apiGet<{ matches: PaperNoteMatch[] }>(
    `/paper-notes/profiles/search?q=${encodeURIComponent(query)}`,
  );
  return result.matches;
}

export async function listPaperNoteEventFamilies() {
  const result = await apiGet<{
    families: Array<{ id: string; name: string; memberCount: number }>;
  }>("/event-families");
  return result.families;
}

export async function savePaperNoteEntryReview(
  entryId: string,
  review: PaperNoteReviewDraft,
  expectedVersion: number,
) {
  const result = await apiPatch<{ entry: PaperNoteReviewEntryDetails }>(
    `/paper-notes/entries/${entryId}`,
    { review, expectedVersion },
  );
  return result.entry;
}

async function paperNoteEntryStateAction(
  entryId: string,
  action: "approve" | "unapprove" | "skip",
  expectedVersion: number,
) {
  const result = await apiPost<{ entry: PaperNoteReviewEntryDetails }>(
    `/paper-notes/entries/${entryId}/${action}`,
    { expectedVersion },
  );
  return result.entry;
}

export function approvePaperNoteEntry(entryId: string, expectedVersion: number) {
  return paperNoteEntryStateAction(entryId, "approve", expectedVersion);
}

export function unapprovePaperNoteEntry(entryId: string, expectedVersion: number) {
  return paperNoteEntryStateAction(entryId, "unapprove", expectedVersion);
}

export function skipPaperNoteEntry(entryId: string, expectedVersion: number) {
  return paperNoteEntryStateAction(entryId, "skip", expectedVersion);
}

export async function preflightPaperNoteBatch(batchId: string) {
  const response = await apiFetch(`/paper-notes/batches/${batchId}/preflight`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  const payload = await response.json().catch(() => ({})) as {
    preflight?: PaperNoteBatchPreflight;
    error?: string;
  };
  if (payload.preflight) return payload.preflight;
  throw new Error(payload.error ?? `API ${response.status}`);
}

export async function importPaperNoteBatch(batchId: string, requestKey: string) {
  const result = await apiPost<{ summary: PaperNoteImportSummary }>(
    `/paper-notes/batches/${batchId}/import`,
    { requestKey },
  );
  return result.summary;
}

export function archivePaperNoteBatch(batchId: string) {
  return apiPost<{ ok: true }>(`/paper-notes/batches/${batchId}/archive`, {});
}
