import type { AttentionResult } from "../google-workspace/email-thread-attention-service";
import {
  activeConnection,
  ConnectionError,
  inputHash,
  transaction,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type MutationKey,
  type OperationReceipt,
  type SqlQuery,
} from "./contracts";
export class OperationStore {
  constructor(private db: ConnectionDatabase) {}
  async perform<T>(
    p: ConnectionPrincipal,
    operation: string,
    key: MutationKey,
    input: unknown,
    work: (tx: SqlQuery) => Promise<OperationReceipt<T>>,
  ): Promise<OperationReceipt<T>> {
    if (
      typeof key.requestKey !== "string" ||
      !key.requestKey.trim() ||
      key.requestKey.length > 200
    )
      throw new ConnectionError("CONNECTION_INVALID_REQUEST_KEY");
    return transaction(this.db, async (tx) => {
      await activeConnection(tx, p, true);
      const hash = inputHash(input),
        prior = (
          await tx.query(
            "SELECT input_hash,receipt FROM chatgpt_operations WHERE connection_id=$1 AND operation=$2 AND request_key=$3",
            [p.connectionId, operation, key.requestKey],
          )
        ).rows[0];
      if (prior) {
        if (prior.input_hash !== hash)
          throw new ConnectionError("CONNECTION_REQUEST_CONFLICT", 409);
        return prior.receipt as OperationReceipt<T>;
      }
      const receipt = await work(tx);
      await tx.query(
        "INSERT INTO chatgpt_operations(id,connection_id,operation,request_key,input_hash,receipt) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
        [
          receipt.operationId,
          p.connectionId,
          operation,
          key.requestKey,
          hash,
          JSON.stringify(receipt),
        ],
      );
      await tx.query(
        "UPDATE chatgpt_connections SET last_used_at=now() WHERE id=$1",
        [p.connectionId],
      );
      return receipt;
    });
  }
  async get(
    p: ConnectionPrincipal,
    id: string,
  ): Promise<OperationReceipt<unknown> | AttentionResult | null> {
    await activeConnection(this.db, p);
    const receipt =
      (
        await this.db.query(
          "SELECT receipt FROM chatgpt_operations WHERE id=$1 AND connection_id=$2",
          [id, p.connectionId],
        )
      ).rows[0]?.receipt ?? null;
    if (receipt) return receipt;
    // Filing receipts use a separate transactional store. Keep lookup scoped
    // to this owner and connector, and never expose internal retry payloads.
    return (
      (
        await this.db.query(
          "SELECT result - 'committed' AS receipt FROM email_thread_attention_operations WHERE id=$1 AND owner_id=$2 AND actor_key=$3",
          [id, p.ownerId, p.connectionId],
        )
      ).rows[0]?.receipt ?? null
    );
  }
}
