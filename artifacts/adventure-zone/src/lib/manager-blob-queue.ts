export type ManagerBlobState = "image_pending" | "uploading" | "image_uploaded" | "image_failed";
export type ManagerBlobKind = "receipt" | "incident" | "checklist_attachment" | "year_end_inspection_photo";

/** receiptId is the legacy generic object identifier for this IndexedDB row. */
export type ManagerBlobRow = {
  id: string;
  legId: string;
  receiptId: string;
  kind?: ManagerBlobKind;
  bookingId?: string;
  inspectionId?: string;
  entryId?: string;
  photoId?: string;
  blob: Blob;
  createdAt: string;
  state: ManagerBlobState;
  lastError?: string;
};

export interface ManagerBlobStore {
  put(row: ManagerBlobRow): Promise<void>;
  list(): Promise<ManagerBlobRow[]>;
  remove(id: string): Promise<void>;
  clearLeg(legId: string): Promise<void>;
}

export class MemoryManagerBlobStore implements ManagerBlobStore {
  rows = new Map<string, ManagerBlobRow>();
  async put(row: ManagerBlobRow) { this.rows.set(row.id, { ...row }); }
  async list() { return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async remove(id: string) { this.rows.delete(id); }
  async clearLeg(legId: string) {
    for (const [id, row] of this.rows) if (row.legId === legId) this.rows.delete(id);
  }
}

class IndexedDbManagerBlobStore implements ManagerBlobStore {
  private async db() {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("adventure-zone-manager-blobs", 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("receipt-blobs")) {
          request.result.createObjectStore("receipt-blobs", { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>) {
    const db = await this.db();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("receipt-blobs", mode);
      const request = run(transaction.objectStore("receipt-blobs"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  }

  async put(row: ManagerBlobRow) { await this.tx("readwrite", (store) => store.put(row)); }
  async list() { return (await this.tx("readonly", (store) => store.getAll())) as ManagerBlobRow[]; }
  async remove(id: string) { await this.tx("readwrite", (store) => store.delete(id)); }
  async clearLeg(legId: string) {
    for (const row of await this.list()) if (row.legId === legId) await this.remove(row.id);
  }
}

export const indexedDbManagerBlobStore: ManagerBlobStore = typeof indexedDB === "undefined"
  ? new MemoryManagerBlobStore()
  : new IndexedDbManagerBlobStore();

export async function queueManagerBlob(
  input: Omit<ManagerBlobRow, "state">,
  store: ManagerBlobStore = indexedDbManagerBlobStore,
) {
  if (input.kind === "checklist_attachment" && !input.bookingId) {
    throw new Error("Checklist attachment blobs require bookingId");
  }
  if (input.kind === "year_end_inspection_photo" && (!input.inspectionId || !input.entryId || !input.photoId)) {
    throw new Error("Year-end inspection photo blobs require inspectionId, entryId, and photoId");
  }
  const existing = (await store.list()).find((row) => row.id === input.id);
  if (existing) return existing;
  const row = { ...input, state: "image_pending" as const };
  await store.put(row);
  return row;
}

export async function flushManagerBlobQueue(
  upload: (row: ManagerBlobRow) => Promise<void>,
  store: ManagerBlobStore = indexedDbManagerBlobStore,
  canUpload?: (row: ManagerBlobRow) => Promise<boolean>,
) {
  for (const row of (await store.list()).filter((candidate) => candidate.state !== "image_uploaded")) {
    if (canUpload && !(await canUpload(row))) continue;
    await store.put({ ...row, state: "uploading", lastError: undefined });
    try {
      await upload(row);
      await store.put({ ...row, state: "image_uploaded", lastError: undefined });
    } catch (error) {
      await store.put({
        ...row,
        state: "image_failed",
        lastError: error instanceof Error ? error.message : "Upload failed",
      });
      break;
    }
  }
  return store.list();
}

export async function clearManagerBlobData(
  legId: string,
  store: ManagerBlobStore = indexedDbManagerBlobStore,
) {
  await store.clearLeg(legId);
}
