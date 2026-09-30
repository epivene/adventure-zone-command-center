import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { ensureChatGPTConnectionSchema } from "../../db/chatgpt-connection-schema";
import { OAuthStore } from "./oauth-store";
let db: PGlite, store: OAuthStore, id: string;
beforeEach(async () => {
  db = new PGlite();
  await ensureChatGPTConnectionSchema(db);
  store = new OAuthStore(db, Buffer.alloc(32, 7));
  id = randomUUID();
  await db.query(
    `INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes,grant_id) VALUES($1,'owner','client','["crm:read"]','grant')`,
    [id],
  );
});
afterEach(async () => db.close());
it("encrypts provider artifacts, expires them and consumes a code only once", async () => {
  const adapter = store.adapter("AuthorizationCode");
  await adapter.upsert(
    "secret-code",
    { grantId: "grant", accountId: "owner", clientId: "client" },
    60,
  );
  const raw = (
    await db.query<{ payload: string }>("SELECT * FROM chatgpt_oauth_artifacts")
  ).rows[0];
  expect(JSON.stringify(raw)).not.toContain("secret-code");
  expect(raw.payload).not.toContain("accountId");
  expect(await adapter.find("secret-code")).toMatchObject({
    accountId: "owner",
  });
  await adapter.consume("secret-code");
  await expect(adapter.consume("secret-code")).rejects.toThrow();
  expect(await adapter.find("secret-code")).toHaveProperty("consumed");
  await db.query(
    "UPDATE chatgpt_oauth_artifacts SET expires_at=now()-interval '1 second'",
  );
  expect(await adapter.find("secret-code")).toBeUndefined();
});
it("revokes all grant artifacts and prevents a late refresh write restoring access", async () => {
  const adapter = store.adapter("RefreshToken");
  await adapter.upsert("old", { grantId: "grant", accountId: "owner" }, 60);
  await store.revoke("owner", id);
  expect(await adapter.find("old")).toBeUndefined();
  await expect(
    adapter.upsert("late", { grantId: "grant", accountId: "owner" }, 60),
  ).rejects.toThrow();
  expect(
    (
      await db.query<{ payload: string }>(
        "SELECT * FROM chatgpt_oauth_artifacts",
      )
    ).rows,
  ).toHaveLength(0);
});
it("only registers exact HTTPS redirects and binds a client to the owner", async () => {
  await expect(
    store.registerClient("owner", {
      name: "ChatGPT",
      redirectUris: ["https://example.com/*"],
    }),
  ).rejects.toThrow();
  const c = await store.registerClient("owner", {
    name: "ChatGPT",
    redirectUris: ["https://example.com/callback"],
  });
  expect(await store.adapter("Client").find(c.clientId)).toMatchObject({
    redirect_uris: ["https://example.com/callback"],
    token_endpoint_auth_method: "none",
  });
  await expect(store.revoke("intruder", id)).rejects.toThrow();
});
