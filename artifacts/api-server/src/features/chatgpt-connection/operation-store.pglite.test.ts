import { afterEach, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureChatGPTConnectionSchema } from "../../db/chatgpt-connection-schema";
import { ensureEmailThreadAttentionSchema } from "../../db/email-thread-attention-schema";
import { OperationStore } from "./operation-store";
import type { ConnectionPrincipal } from "./contracts";
let db: PGlite;
let principal: ConnectionPrincipal;
let store: OperationStore;
beforeEach(async () => {
  db = new PGlite();
  await ensureChatGPTConnectionSchema(db);
  await ensureEmailThreadAttentionSchema(db);
  principal = {
    ownerId: "owner",
    connectionId: randomUUID(),
    clientId: "client",
    scopes: ["crm:read", "crm:append"],
  };
  await db.query(
    "INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4::jsonb)",
    [
      principal.connectionId,
      "owner",
      "client",
      JSON.stringify(principal.scopes),
    ],
  );
  await db.exec(
    "CREATE TABLE test_notes(id uuid PRIMARY KEY, body text NOT NULL)",
  );
  store = new OperationStore(db);
});
afterEach(async () => {
  await db.close();
});
const work = async (tx: any) => {
  const id = randomUUID();
  await tx.query("INSERT INTO test_notes VALUES($1,$2)", [id, "Research"]);
  return {
    operationId: randomUUID(),
    recordId: id,
    href: "/profiles/example",
    revision: "1",
    savedAt: new Date().toISOString(),
    value: { noteId: id },
  };
};
it("replays a committed save once and rejects changed input under its key", async () => {
  const first = await store.perform(
    principal,
    "append_note",
    { requestKey: "a" },
    { body: "Research" },
    work,
  );
  const second = await store.perform(
    principal,
    "append_note",
    { requestKey: "a" },
    { body: "Research" },
    work,
  );
  expect(second).toEqual(first);
  expect((await db.query("SELECT * FROM test_notes")).rows).toHaveLength(1);
  await expect(
    store.perform(
      principal,
      "append_note",
      { requestKey: "a" },
      { body: "Different" },
      work,
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_REQUEST_CONFLICT" });
});
it("rolls back a failed save and its receipt together", async () => {
  await expect(
    store.perform(
      principal,
      "append_note",
      { requestKey: "a" },
      {},
      async (tx) => {
        await work(tx);
        throw Error("rollback");
      },
    ),
  ).rejects.toThrow("rollback");
  expect((await db.query("SELECT * FROM test_notes")).rows).toHaveLength(0);
  expect(
    (await db.query("SELECT * FROM chatgpt_operations")).rows,
  ).toHaveLength(0);
});
it("isolates receipts and rejects revoked or forged connections", async () => {
  const saved = await store.perform(
    principal,
    "append_note",
    { requestKey: "a" },
    {},
    work,
  );
  const other = { ...principal, connectionId: randomUUID() };
  await db.query(
    "INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4::jsonb)",
    [other.connectionId, "owner", "client", JSON.stringify(other.scopes)],
  );
  expect(await store.get(other, saved.operationId)).toBeNull();
  await expect(
    store.perform(
      { ...principal, ownerId: "intruder" },
      "append_note",
      { requestKey: "b" },
      {},
      work,
    ),
  ).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
  await db.query(
    "UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",
    [principal.connectionId],
  );
  await expect(store.get(principal, saved.operationId)).rejects.toMatchObject({
    code: "CONNECTION_REVOKED",
  });
});
it("retains data when schema installation runs twice", async () => {
  await store.perform(principal, "append_note", { requestKey: "a" }, {}, work);
  await ensureChatGPTConnectionSchema(db);
  expect(
    (await db.query("SELECT * FROM chatgpt_operations")).rows,
  ).toHaveLength(1);
});

it("returns only the owning connection's filing receipt without private retry data", async () => {
  const attentionId = randomUUID(),
    operationId = randomUUID();
  await db.query(
    `INSERT INTO email_thread_attention(id,gmail_connection_id,thread_id,profile_id,state,reason,subject,reviewed_message_id,revision,actor_id)
 VALUES($1,$2,'thread',$3,'waiting_for_their_reply','Await reply','Fair','message',$4,'owner')`,
    [attentionId, randomUUID(), randomUUID(), randomUUID()],
  );
  const receipt = {
    operationId,
    record: { id: attentionId, state: "waiting_for_their_reply" },
    assignment: "committed",
    gmailSync: { state: "completed" },
    archiveSync: { state: "complete" },
  };
  await db.query(
    `INSERT INTO email_thread_attention_operations(id,owner_id,actor_key,request_key,request_hash,preview_id,attention_id,result)
 VALUES($1,$2,$3,'key','hash',$4,$5,$6)`,
    [
      operationId,
      principal.ownerId,
      principal.connectionId,
      randomUUID(),
      attentionId,
      JSON.stringify({
        ...receipt,
        committed: { privateRetryData: "must not return" },
      }),
    ],
  );
  expect(await store.get(principal, operationId)).toEqual(receipt);
  const other = { ...principal, connectionId: randomUUID() };
  await db.query(
    "INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes) VALUES($1,$2,$3,$4::jsonb)",
    [
      other.connectionId,
      other.ownerId,
      other.clientId,
      JSON.stringify(other.scopes),
    ],
  );
  expect(await store.get(other, operationId)).toBeNull();
  expect(await store.get(principal, randomUUID())).toBeNull();
  await expect(
    store.get({ ...principal, ownerId: "other-owner" }, operationId),
  ).rejects.toMatchObject({ code: "CONNECTION_ACCESS_DENIED" });
  await db.query(
    "UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",
    [principal.connectionId],
  );
  await expect(store.get(principal, operationId)).rejects.toMatchObject({
    code: "CONNECTION_REVOKED",
  });
});
