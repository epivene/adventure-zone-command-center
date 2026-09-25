import { apiFetch } from "@/lib/auth-token";
import type { Screenshot } from "./types";
const path = (conversationId: string, id: string) =>
  `/assistant/workspace/conversations/${encodeURIComponent(conversationId)}/screenshots/${encodeURIComponent(id)}`;
export async function uploadScreenshot(
  conversationId: string,
  id: string,
  file: File,
  signal?: AbortSignal,
): Promise<Screenshot> {
  const response = await apiFetch(path(conversationId, id), {
    method: "PUT",
    headers: {
      "Content-Type": file.type,
      "X-File-Name": encodeURIComponent(file.name),
    },
    body: file,
    signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.code ?? "ASSISTANT_SCREENSHOT_UPLOAD_FAILED");
  }
  return response.json();
}
export async function readScreenshot(
  conversationId: string,
  id: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await apiFetch(path(conversationId, id), { signal });
  if (!response.ok) throw new Error("ASSISTANT_SCREENSHOT_READ_FAILED");
  return response.blob();
}
