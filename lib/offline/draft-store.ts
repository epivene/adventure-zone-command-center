const DRAFT_NAMESPACE = "azcc:draft:";
const DRAFT_SCHEMA_VERSION = 1;

type DraftRecord<T> = {
  version: typeof DRAFT_SCHEMA_VERSION;
  savedAt: string;
  data: T;
};

export type DraftStorageResult =
  | { ok: true }
  | {
      ok: false;
      error: "serialization_failed" | "storage_unavailable";
    };

function storageKey(key: string) {
  return `${DRAFT_NAMESPACE}${key}`;
}

export function saveDraft<T>(key: string, data: T): DraftStorageResult {
  const record: DraftRecord<T> = {
    version: DRAFT_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  };

  let serialized: string;
  try {
    serialized = JSON.stringify(record);
  } catch {
    return { ok: false, error: "serialization_failed" };
  }

  try {
    localStorage.setItem(storageKey(key), serialized);
    return { ok: true };
  } catch {
    return { ok: false, error: "storage_unavailable" };
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const serialized = localStorage.getItem(storageKey(key));
    if (!serialized) return null;

    const record = JSON.parse(serialized) as Partial<DraftRecord<T>>;
    if (
      record.version !== DRAFT_SCHEMA_VERSION ||
      typeof record.savedAt !== "string" ||
      !("data" in record)
    ) {
      return null;
    }
    return record.data ?? null;
  } catch {
    return null;
  }
}

export function deleteDraft(key: string): DraftStorageResult {
  try {
    localStorage.removeItem(storageKey(key));
    return { ok: true };
  } catch {
    return { ok: false, error: "storage_unavailable" };
  }
}
