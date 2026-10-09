export type ManagerMutationState = "saved_offline" | "syncing" | "synced" | "needs_attention";

export type ManagerMutation = {
  id: string;
  legId: string;
  method: string;
  path: string;
  body: unknown;
  createdAt: string;
  state: ManagerMutationState;
  lastError?: string;
};

export interface ManagerMutationStore {
  put(mutation: ManagerMutation): Promise<void>;
  list(): Promise<ManagerMutation[]>;
  remove(id: string): Promise<void>;
  clearLeg(legId: string): Promise<void>;
}

const DB_NAME = "adventure-zone-manager";
const STORE = "mutations";

export function openManagerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      if (!db.objectStoreNames.contains("crew-snapshots")) db.createObjectStore("crew-snapshots", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void, fail: (error: unknown) => void) => void): Promise<T> {
  const db = await openManagerDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    work(store, resolve, reject);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export const indexedDbManagerMutationStore: ManagerMutationStore = {
  put: (mutation) => withStore<void>("readwrite", (store, done, fail) => {
    const request = store.put(mutation);
    request.onsuccess = () => done();
    request.onerror = () => fail(request.error);
  }),
  list: () => withStore<ManagerMutation[]>("readonly", (store, done, fail) => {
    const request = store.getAll();
    request.onsuccess = () => done((request.result as ManagerMutation[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
    request.onerror = () => fail(request.error);
  }),
  remove: (id) => withStore<void>("readwrite", (store, done, fail) => {
    const request = store.delete(id);
    request.onsuccess = () => done();
    request.onerror = () => fail(request.error);
  }),
  clearLeg: async (legId) => {
    const rows = await indexedDbManagerMutationStore.list();
    await Promise.all(rows.filter((row) => row.legId === legId).map((row) => indexedDbManagerMutationStore.remove(row.id)));
  },
};
