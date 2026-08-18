import { describe, expect, it } from "vitest";
import {
  createReceiptMetadata,
  deleteReceipt,
  uploadReceiptImage,
  type ReceiptMetadataStore,
  type ReceiptObjectStorage,
} from "./receipt-service";

function store(): ReceiptMetadataStore & { rows: any[] } {
  const rows: any[] = [];
  return {
    rows,
    async expenseBelongsToLeg(legId, expenseId) { return legId === "leg-a" && expenseId === "expense-a"; },
    async findByMutation(legId, id) { return rows.find((row) => row.legId === legId && row.clientMutationId === id) ?? null; },
    async create(input) { const row = { imageStatus: "image_pending", objectKey: null, ...input }; rows.push(row); return row; },
    async setImageState(legId, id, state) { const row = rows.find((item) => item.legId === legId && item.id === id); if (row) Object.assign(row, state); return row ?? null; },
    async getForLeg(legId, id) { return rows.find((row) => row.legId === legId && row.id === id) ?? null; },
    async listForExpense(legId, expenseId) { return rows.filter((row) => row.legId === legId && row.expenseId === expenseId); },
    async deleteForLeg(legId, id) { const index = rows.findIndex((row) => row.legId === legId && row.id === id); return index >= 0 ? rows.splice(index, 1)[0] : null; },
  };
}

describe("receipt service", () => {
  it("keeps metadata when image upload fails", async () => {
    const metadata = store();
    const input = { id: "receipt-a", legId: "leg-a", expenseId: "expense-a", clientMutationId: "00000000-0000-4000-8000-000000000001", mimeType: "image/jpeg" };
    expect((await createReceiptMetadata(metadata, input)).ok).toBe(true);
    const storage: ReceiptObjectStorage = { async put() { throw new Error("offline"); }, async getSignedReadUrl() { return ""; } };
    expect((await uploadReceiptImage(metadata, storage, { legId: "leg-a", receiptId: "receipt-a", mimeType: "image/jpeg", bytes: new Uint8Array([1]) })).ok).toBe(false);
    expect(metadata.rows).toHaveLength(1);
    expect(metadata.rows[0].imageStatus).toBe("image_failed");
  });

  it("rejects another leg expense", async () => {
    const metadata = store();
    expect(await createReceiptMetadata(metadata, { id: "receipt-b", legId: "leg-b", expenseId: "expense-a", clientMutationId: "00000000-0000-4000-8000-000000000002", mimeType: "image/jpeg" })).toEqual({ ok: false, error: "OUTSIDE_LEG" });
  });

  it("deletes the stored object before removing receipt metadata", async () => {
    const metadata = store();
    metadata.rows.push({ id: "receipt-a", legId: "leg-a", expenseId: "expense-a", objectKey: "leg-receipts/leg-a/receipt-a" });
    const deleted: string[] = [];
    const storage: ReceiptObjectStorage = {
      async put() {},
      async getSignedReadUrl() { return ""; },
      async delete(key) { deleted.push(key); },
    };
    expect((await deleteReceipt(metadata, storage, { legId: "leg-a", receiptId: "receipt-a" })).ok).toBe(true);
    expect(deleted).toEqual(["leg-receipts/leg-a/receipt-a"]);
    expect(metadata.rows).toHaveLength(0);
  });
});
