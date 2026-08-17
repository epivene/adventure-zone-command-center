import type {
  ActiveAssistantContext,
  AssistantContextBundle,
  BookingBrief,
} from "./assistant-types";

export type AssistantCachedSnapshot = {
  key: string;
  kind: Exclude<ActiveAssistantContext, null>["kind"];
  recordId: string;
  label: string;
  savedAt: string;
  context: AssistantContextBundle;
  brief: BookingBrief;
};

export function assistantCacheKey(
  context: Exclude<ActiveAssistantContext, null>,
): string {
  return `${context.kind}:${context.recordId}`;
}

export function pruneAssistantSnapshots(
  snapshots: readonly AssistantCachedSnapshot[],
  options: {
    now?: Date;
    maxEntries?: number;
    maxAgeDays?: number;
  } = {},
): AssistantCachedSnapshot[] {
  const now = options.now ?? new Date();
  const maxEntries = options.maxEntries ?? 20;
  const maxAgeDays = options.maxAgeDays ?? 30;
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  return [...snapshots]
    .filter((snapshot) => new Date(snapshot.savedAt).getTime() >= cutoff)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, maxEntries);
}

const DB_NAME = "adventure-zone-assistant";
const STORE = "context-snapshots";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(): Promise<AssistantCachedSnapshot[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as AssistantCachedSnapshot[]);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function remove(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const request = tx.objectStore(STORE).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export async function saveAssistantSnapshot(input: {
  contextRef: Exclude<ActiveAssistantContext, null>;
  context: AssistantContextBundle;
  brief: BookingBrief;
}): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const snapshot: AssistantCachedSnapshot = {
    key: assistantCacheKey(input.contextRef),
    kind: input.contextRef.kind,
    recordId: input.contextRef.recordId,
    label: input.contextRef.label ?? input.context.context.label,
    savedAt: new Date().toISOString(),
    context: input.context,
    brief: input.brief,
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const request = tx.objectStore(STORE).put(snapshot);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });

  const all = await getAll();
  const keep = pruneAssistantSnapshots(all);
  const keepKeys = new Set(keep.map((row) => row.key));
  await Promise.all(
    all.filter((row) => !keepKeys.has(row.key)).map((row) => remove(row.key)),
  );
}

export async function getAssistantSnapshot(
  context: Exclude<ActiveAssistantContext, null>,
): Promise<AssistantCachedSnapshot | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(assistantCacheKey(context));
    request.onsuccess = () => {
      const row = request.result as AssistantCachedSnapshot | undefined;
      if (!row) {
        resolve(null);
        return;
      }
      const [fresh] = pruneAssistantSnapshots([row]);
      resolve(fresh ?? null);
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}
