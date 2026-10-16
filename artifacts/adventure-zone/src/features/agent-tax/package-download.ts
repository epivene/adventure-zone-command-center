import { apiFetch } from "@/lib/auth-token";

export const MAX_BUFFERED_PACKAGE_BYTES = 64 * 1024 * 1024;
type FileWriter = {
  write(bytes: Uint8Array): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
};
type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<FileWriter> }>;

/** Bearer stays in the header. Never navigate to a credential-bearing or signed URL. */
export async function downloadAccountantPackage(year: number): Promise<"saved" | "started" | "cancelled"> {
  const name = `booking-agent-accountant-${year}.zip`;
  const picker = (window as Window & { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  let writer: FileWriter | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // Called before the first network await so browser user activation is preserved.
    if (picker) {
      const handle = await picker.call(window, {
        suggestedName: name, types: [{ description: "Accountant ZIP package", accept: { "application/zip": [".zip"] } }],
      });
      writer = await handle.createWritable();
    }
    const response = await apiFetch(`/admin/agent-tax/package?year=${year}`, { cache: "no-store" });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(error.error ?? `Package download failed (${response.status}).`);
    }
    if (!response.body) throw new Error("This browser cannot download a streamed package.");
    reader = response.body.getReader();
    const chunks: BlobPart[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (writer) {
        await writer.write(value);
      } else {
        total += value.byteLength;
        if (total > MAX_BUFFERED_PACKAGE_BYTES) {
          throw new Error("This package is larger than this browser's safe 64 MB download limit. Use desktop Chrome or Edge with Save File support to stream it directly to disk.");
        }
        chunks.push(value as BlobPart);
      }
    }
    if (writer) {
      await writer.close();
      writer = undefined;
      return "saved";
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: "application/zip" }));
    const link = document.createElement("a");
    link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return "started";
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    await writer?.abort().catch(() => undefined);
    if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
