const DRAFT_NAMESPACE = "azcc:draft:";
const SERVER_SAVED_DRAFT_NAMESPACE = "azcc:server-saved-draft:";
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

function serverSavedKey(key: string) {
  return `${SERVER_SAVED_DRAFT_NAMESPACE}${key}`;
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
    window.localStorage.setItem(storageKey(key), serialized);
    try {
      const suppressed = window.sessionStorage.getItem(serverSavedKey(key));
      if (suppressed && suppressed !== serialized) {
        window.sessionStorage.removeItem(serverSavedKey(key));
      }
    } catch {
      // The durable local draft is still usable when session storage is absent.
    }
    return { ok: true };
  } catch {
    return { ok: false, error: "storage_unavailable" };
  }
}

export function loadDraft<T>(key: string): T | null {
  try {
    const serialized = window.localStorage.getItem(storageKey(key));
    if (!serialized) return null;
    try {
      if (window.sessionStorage.getItem(serverSavedKey(key)) === serialized) {
        return null;
      }
    } catch {
      // Fall through to the local record when session storage is unavailable.
    }

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
  let staleCopy: string | null = null;
  try {
    staleCopy = window.localStorage.getItem(storageKey(key));
  } catch {
    // The removal attempt below remains authoritative.
  }

  try {
    window.localStorage.removeItem(storageKey(key));
    try {
      window.sessionStorage.removeItem(serverSavedKey(key));
    } catch {
      // A successful local deletion needs no fallback marker.
    }
    return { ok: true };
  } catch {
    if (staleCopy) {
      try {
        window.sessionStorage.setItem(serverSavedKey(key), staleCopy);
      } catch {
        // The caller still receives a failure and keeps server state authoritative.
      }
    }
    return { ok: false, error: "storage_unavailable" };
  }
}
