import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeOfflineRecord, readOfflineRecord } from "./offline-db";
let stored: any, pending: any, written: boolean, transaction: any;
function browserStorage() {
  const database: any = {
    close() {},
    transaction() {
      pending = structuredClone(stored);
      written = false;
      transaction = {
        error: null,
        abort() {
          queueMicrotask(() => transaction.onabort?.());
        },
        objectStore() {
          return store;
        },
      };
      const store = {
        transaction,
        get() {
          const request: any = { result: structuredClone(stored) };
          queueMicrotask(() => request.onsuccess?.());
          return request;
        },
        put(value: unknown) {
          pending = structuredClone(value);
          written = true;
        },
        delete() {
          pending = null;
          written = true;
        },
      };
      return transaction;
    },
  };
  vi.stubGlobal("indexedDB", {
    open() {
      const request: any = { result: database };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  });
}
beforeEach(() => {
  stored = null;
  written = false;
  transaction = undefined;
  pending = null;
  browserStorage();
});
afterEach(() => vi.unstubAllGlobals());
it("reports a saved record only after its IndexedDB transaction commits", async () => {
  let settled = false;
  const operation = changeOfflineRecord(() => ({
    record: { digest: "digest", snapshots: [] },
    value: "saved",
  })).then((value) => {
    settled = true;
    return value;
  });
  await vi.waitFor(() => expect(written).toBe(true));
  expect(settled).toBe(false);
  expect(stored).toBeNull();
  stored = pending;
  transaction.oncomplete();
  expect(await operation).toBe("saved");
  expect(stored.digest).toBe("digest");
});
it("does not report ready when the write request succeeds but the transaction aborts", async () => {
  const operation = changeOfflineRecord(() => ({
    record: { digest: "digest", snapshots: [] },
    value: "saved",
  }));
  const failure = expect(operation).rejects.toThrow(/quota/i);
  await vi.waitFor(() => expect(written).toBe(true));
  transaction.error = new Error("Quota exceeded");
  transaction.onabort();
  await failure;
  expect(stored).toBeNull();
});
it("rejects a guarded update without losing its original error or committing changes", async () => {
  const operation = changeOfflineRecord(() => {
    throw new Error("Owner changed");
  });
  await expect(operation).rejects.toThrow("Owner changed");
  expect(stored).toBeNull();
});
it("rejects unavailable browser storage instead of silently claiming a save", async () => {
  vi.stubGlobal("indexedDB", undefined);
  await expect(readOfflineRecord()).rejects.toThrow(/unavailable/i);
});

it("orders logout clearing before a subsequent save", async () => {
  const first = changeOfflineRecord(() => ({ record: null, value: "cleared" }));
  const second = changeOfflineRecord(() => ({
    record: { digest: "new owner", snapshots: [] },
    value: "saved",
  }));
  await vi.waitFor(() => expect(written).toBe(true));
  expect(pending).toBeNull();
  stored = pending;
  transaction.oncomplete();
  await first;
  await vi.waitFor(() => expect(pending?.digest).toBe("new owner"));
  stored = pending;
  transaction.oncomplete();
  await second;
  expect(stored.digest).toBe("new owner");
});
