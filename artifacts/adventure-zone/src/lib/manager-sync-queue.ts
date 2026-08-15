import { indexedDbManagerMutationStore, type ManagerMutation, type ManagerMutationStore } from "./manager-offline-db";

export class MemoryManagerMutationStore implements ManagerMutationStore {
  rows = new Map<string, ManagerMutation>();
  async put(mutation: ManagerMutation) { this.rows.set(mutation.id, { ...mutation }); }
  async list() { return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  async remove(id: string) { this.rows.delete(id); }
  async clearLeg(legId: string) { for (const [id, row] of this.rows) if (row.legId === legId) this.rows.delete(id); }
}

type ManagerApi = <T>(path: string, options?: RequestInit) => Promise<T>;

export async function queueManagerMutation(input: Omit<ManagerMutation, "state">, store: ManagerMutationStore = indexedDbManagerMutationStore) {
  const existing = (await store.list()).find((row) => row.id === input.id);
  if (existing) return existing;
  const mutation: ManagerMutation = { ...input, state: "saved_offline" };
  await store.put(mutation);
  return mutation;
}

export async function flushManagerMutationQueue(managerApi: ManagerApi, store: ManagerMutationStore = indexedDbManagerMutationStore) {
  const rows = (await store.list()).filter((row) => row.state !== "synced" && row.state !== "needs_attention");
  for (const row of rows) {
    await store.put({ ...row, state: "syncing", lastError: undefined });
    try {
      await managerApi(row.path, { method: row.method, body: JSON.stringify(row.body) });
      await store.put({ ...row, state: "synced", lastError: undefined });
    } catch (error) {
      const status = typeof error === "object" && error && "status" in error ? Number((error as { status?: number }).status) : undefined;
      if (status === 409) {
        await store.put({ ...row, state: "needs_attention", lastError: error instanceof Error ? error.message : "Conflict" });
        continue;
      }
      await store.put({ ...row, state: "saved_offline", lastError: error instanceof Error ? error.message : "Offline" });
      break;
    }
  }
  return store.list();
}

export async function clearManagerPrivateData(legId: string, store: ManagerMutationStore = indexedDbManagerMutationStore) {
  await store.clearLeg(legId);
}
