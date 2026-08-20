import {
  createPaperNotePage,
  uploadPaperNotePageImage,
} from "./paper-note-client";
import type {
  PaperNoteUploadProgress,
  PaperNoteUploadResult,
} from "./paper-note-types";

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function uploadPaperNoteFiles(input: {
  batchId: string;
  files: File[];
  onProgress(update: PaperNoteUploadProgress): void;
  signal?: AbortSignal;
}): Promise<PaperNoteUploadResult[]> {
  if (input.files.length > 25) {
    throw new Error("A paper-note batch can contain up to 25 photos.");
  }

  const results: PaperNoteUploadResult[] = [];
  for (let index = 0; index < input.files.length; index += 1) {
    if (input.signal?.aborted) break;
    const file = input.files[index]!;
    const fileKey = crypto.randomUUID();
    const base = {
      fileKey,
      filename: file.name,
      index,
      total: input.files.length,
    };

    input.onProgress({ ...base, state: "pending", pageId: null, error: null });
    if (!acceptedTypes.has(file.type) || file.size > 12 * 1024 * 1024 || file.size < 1) {
      const error = acceptedTypes.has(file.type)
        ? "Each photo must be 12 MB or smaller."
        : "Use a JPEG, PNG, or WebP photo.";
      input.onProgress({ ...base, state: "failed", pageId: null, error });
      results.push({ fileKey, pageId: null, ok: false, error });
      continue;
    }

    let pageId: string | null = null;
    try {
      input.onProgress({ ...base, state: "creating_page", pageId: null, error: null });
      const created = await createPaperNotePage({
        batchId: input.batchId,
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      pageId = created.pageId;
      input.onProgress({ ...base, state: "uploading", pageId, error: null });
      await uploadPaperNotePageImage({ batchId: input.batchId, pageId, file });
      input.onProgress({ ...base, state: "uploaded", pageId, error: null });
      results.push({ fileKey, pageId, ok: true, error: null });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The photo could not be uploaded.";
      input.onProgress({ ...base, state: "failed", pageId, error: message });
      results.push({ fileKey, pageId, ok: false, error: message });
    }
  }
  return results;
}
