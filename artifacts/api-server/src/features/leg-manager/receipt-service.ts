import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { legExpenses, legReceipts } from "@/db/schema";
import type { LegManagerObjectStorage } from "./leg-manager-object-storage";

export type ReceiptObjectStorage = LegManagerObjectStorage;
export type ReceiptCreateInput = {
  id: string;
  legId: string;
  expenseId: string;
  clientMutationId: string;
  mimeType: string | null;
};

export interface ReceiptMetadataStore {
  expenseBelongsToLeg(legId: string, expenseId: string): Promise<boolean>;
  findByMutation(legId: string, id: string): Promise<any | null>;
  create(input: ReceiptCreateInput): Promise<any>;
  setImageState(
    legId: string,
    id: string,
    state: {
      imageStatus: "image_pending" | "image_uploaded" | "image_failed";
      objectKey?: string | null;
      mimeType?: string | null;
    },
  ): Promise<any | null>;
  getForLeg(legId: string, receiptId: string): Promise<any | null>;
  listForExpense(legId: string, expenseId: string): Promise<any[]>;
  deleteForLeg(legId: string, receiptId: string): Promise<any | null>;
}

export async function createReceiptMetadata(
  store: ReceiptMetadataStore,
  input: ReceiptCreateInput,
) {
  const existing = await store.findByMutation(input.legId, input.clientMutationId);
  if (existing) return { ok: true as const, idempotent: true, receipt: existing };
  if (!(await store.expenseBelongsToLeg(input.legId, input.expenseId))) {
    return { ok: false as const, error: "OUTSIDE_LEG" as const };
  }
  return { ok: true as const, idempotent: false, receipt: await store.create(input) };
}

export async function uploadReceiptImage(
  store: ReceiptMetadataStore,
  storage: ReceiptObjectStorage,
  input: { legId: string; receiptId: string; mimeType: string; bytes: Uint8Array },
  options?: { onStorageError?: (error: unknown) => void },
) {
  if (!(await store.getForLeg(input.legId, input.receiptId))) {
    return { ok: false as const, error: "OUTSIDE_LEG" as const };
  }
  const key = `leg-receipts/${input.legId}/${input.receiptId}`;
  try {
    await storage.put(key, input.bytes, input.mimeType);
    return {
      ok: true as const,
      receipt: await store.setImageState(input.legId, input.receiptId, {
        imageStatus: "image_uploaded",
        objectKey: key,
        mimeType: input.mimeType,
      }),
    };
  } catch (error) {
    options?.onStorageError?.(error);
    await store.setImageState(input.legId, input.receiptId, {
      imageStatus: "image_failed",
      objectKey: null,
      mimeType: input.mimeType,
    });
    return { ok: false as const, error: "UPLOAD_FAILED" as const };
  }
}

export async function deleteReceipt(
  store: ReceiptMetadataStore,
  storage: ReceiptObjectStorage,
  input: { legId: string; receiptId: string },
) {
  const receipt = await store.getForLeg(input.legId, input.receiptId);
  if (!receipt) return { ok: false as const, error: "OUTSIDE_LEG" as const };
  if (receipt.objectKey && storage.delete) await storage.delete(receipt.objectKey);
  return { ok: true as const, receipt: await store.deleteForLeg(input.legId, input.receiptId) };
}

export async function deleteExpenseReceiptObjects(
  store: ReceiptMetadataStore,
  storage: ReceiptObjectStorage,
  input: { legId: string; expenseId: string },
) {
  const receipts = await store.listForExpense(input.legId, input.expenseId);
  for (const receipt of receipts) {
    if (receipt.objectKey && storage.delete) await storage.delete(receipt.objectKey);
  }
  return receipts;
}

export class DrizzleReceiptMetadataStore implements ReceiptMetadataStore {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async expenseBelongsToLeg(legId: string, expenseId: string) {
    return Boolean((await this.database.select({ id: legExpenses.id }).from(legExpenses).where(and(eq(legExpenses.id, expenseId), eq(legExpenses.legId, legId))).limit(1))[0]);
  }

  async findByMutation(legId: string, id: string) {
    return (await this.database.select().from(legReceipts).where(and(eq(legReceipts.legId, legId), eq(legReceipts.clientMutationId, id))).limit(1))[0] ?? null;
  }

  async create(input: ReceiptCreateInput) {
    return (await this.database.insert(legReceipts).values(input).onConflictDoNothing({ target: [legReceipts.legId, legReceipts.clientMutationId] }).returning())[0]
      ?? await this.findByMutation(input.legId, input.clientMutationId);
  }

  async setImageState(legId: string, id: string, state: any) {
    return (await this.database.update(legReceipts).set({ ...state, updatedAt: new Date() }).where(and(eq(legReceipts.id, id), eq(legReceipts.legId, legId))).returning())[0] ?? null;
  }

  async getForLeg(legId: string, id: string) {
    return (await this.database.select().from(legReceipts).where(and(eq(legReceipts.id, id), eq(legReceipts.legId, legId))).limit(1))[0] ?? null;
  }

  async listForExpense(legId: string, expenseId: string) {
    return this.database.select().from(legReceipts).where(and(eq(legReceipts.legId, legId), eq(legReceipts.expenseId, expenseId)));
  }

  async deleteForLeg(legId: string, id: string) {
    return (await this.database.delete(legReceipts).where(and(eq(legReceipts.id, id), eq(legReceipts.legId, legId))).returning())[0] ?? null;
  }
}
