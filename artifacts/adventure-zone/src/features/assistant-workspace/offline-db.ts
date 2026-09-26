import type { OfflineRecord } from "./offline-store";
const databaseName = "az-assistant-offline-workspace";
const storeName = "workspace";
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(
        new Error(
          "Device storage is unavailable. Offline preparation was not saved.",
        ),
      );
      return;
    }
    const request = indexedDB.open(databaseName, 1);
    let settled = false;
    request.onupgradeneeded = () => {
      request.result.createObjectStore(storeName);
    };
    request.onerror = () => {
      settled = true;
      reject(request.error ?? new Error("Device storage could not be opened."));
    };
    request.onblocked = () => {
      settled = true;
      reject(new Error("Close other app tabs and try preparing again."));
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      const database = request.result;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (
    store: IDBObjectStore,
    finish: (value: T) => void,
    fail: (error: unknown) => void,
  ) => void,
): Promise<T> {
  const database = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction;
    let value: T;
    try {
      tx = database.transaction(storeName, mode);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    tx.oncomplete = () => {
      database.close();
      resolve(value);
    };
    tx.onabort = tx.onerror = () => {
      database.close();
      reject(
        tx.error ??
          new Error(
            "Device storage write failed. Your changes were not saved.",
          ),
      );
    };
    const fail = (error: unknown) => {
      reject(error);
      tx.abort();
    };
    try {
      operation(
        tx.objectStore(storeName),
        (result) => {
          value = result;
        },
        fail,
      );
    } catch (error) {
      fail(error);
    }
  });
}
// Enqueue before opening IDB so a delayed open cannot reorder logout and save.
let operations: Promise<unknown> = Promise.resolve();
function ordered<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation, operation);
  operations = result.catch(() => undefined);
  return result;
}
export function readOfflineRecord(): Promise<OfflineRecord | null> {
  return ordered(() =>
    transaction("readonly", (store, finish) => {
      const request = store.get("owner");
      request.onsuccess = () => finish(request.result ?? null);
    }),
  );
}
export function changeOfflineRecord<T>(
  change: (record: OfflineRecord | null) => {
    record: OfflineRecord | null;
    value: T;
  },
): Promise<T> {
  return ordered(() =>
    transaction("readwrite", (store, finish, fail) => {
      const request = store.get("owner");
      request.onsuccess = () => {
        try {
          const result = change(request.result ?? null);
          if (result.record) store.put(result.record, "owner");
          else store.delete("owner");
          finish(result.value);
        } catch (error) {
          // Abort rolls back every write; preserve the business error for the caller.
          fail(error);
        }
      };
    }),
  );
}
