import { apiPost } from "@/lib/auth-token";

export function createPaperNotePageForYear(input: {
  batchId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  paperYear: number;
}) {
  return apiPost<{ pageId: string }>(`/paper-notes/batches/${input.batchId}/pages`, {
    filename: input.filename,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    paperYear: input.paperYear,
  });
}
