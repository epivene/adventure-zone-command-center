import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import type { Adapter, AdapterPayload } from "oidc-provider";
import {
  ConnectionError,
  transaction,
  type ConnectionDatabase,
  type SqlQuery,
} from "./contracts";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
export class OAuthStore {
  constructor(
    readonly db: ConnectionDatabase,
    private key: Buffer,
  ) {
    if (key.length !== 32)
      throw new Error(
        "CHATGPT_CONNECTION_ENCRYPTION_KEY must decode to 32 bytes",
      );
  }
  private seal(value: unknown) {
    const iv = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", this.key, iv);
    return Buffer.concat([
      iv,
      cipher.update(JSON.stringify(value)),
      cipher.final(),
      cipher.getAuthTag(),
    ]).toString("base64");
  }
  private open(value: string): AdapterPayload {
    const b = Buffer.from(value, "base64"),
      dec = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    dec.setAuthTag(b.subarray(-16));
    return JSON.parse(
      Buffer.concat([dec.update(b.subarray(12, -16)), dec.final()]).toString(),
    );
  }
  private async grantActive(tx: SqlQuery, grantId: string, lock = false) {
    const row = (
      await tx.query(
        "SELECT revoked_at FROM chatgpt_connections WHERE grant_id=$1" +
          (lock ? " FOR UPDATE" : ""),
        [grantId],
      )
    ).rows[0];
    return !!row && !row.revoked_at;
  }
  adapter(model: string): Adapter {
    const store = this;
    async function findBy(column: string, value: string) {
      if (model === "Client") {
        const row = (
          await store.db.query(
            "SELECT metadata FROM chatgpt_oauth_clients WHERE id=$1",
            [value],
          )
        ).rows[0];
        return row?.metadata;
      }
      const row = (
        await store.db.query(
          `SELECT * FROM chatgpt_oauth_artifacts WHERE model=$1 AND ${column}=$2 AND (expires_at IS NULL OR expires_at>now())`,
          [model, column === "id_hash" ? digest(value) : value],
        )
      ).rows[0];
      if (
        !row ||
        (row.grant_id && !(await store.grantActive(store.db, row.grant_id)))
      )
        return undefined;
      const payload = store.open(row.payload);
      if (row.consumed_at) payload.consumed = Number(row.consumed_at);
      return payload;
    }
    return {
      find: (id) => findBy("id_hash", id),
      findByUid: (uid) => findBy("uid", uid),
      findByUserCode: (code) => findBy("user_code", code),
      upsert: async (id, payload, expiresIn) =>
        transaction(store.db, async (tx) => {
          if (model === "Client")
            throw new ConnectionError(
              "CONNECTION_OWNER_REGISTRATION_REQUIRED",
              403,
            );
          const grantId =
            payload.grantId ?? (model === "Grant" ? id : undefined);
          if (grantId && !(await store.grantActive(tx, grantId, true)))
            throw new ConnectionError("CONNECTION_REVOKED", 401);
          await tx.query(
            `INSERT INTO chatgpt_oauth_artifacts(model,id_hash,payload,grant_id,uid,user_code,expires_at) VALUES($1,$2,$3,$4,$5,$6,CASE WHEN $7::integer IS NULL THEN NULL ELSE now()+$7*interval '1 second' END) ON CONFLICT(model,id_hash) DO UPDATE SET payload=excluded.payload,grant_id=excluded.grant_id,uid=excluded.uid,user_code=excluded.user_code,expires_at=excluded.expires_at`,
            [
              model,
              digest(id),
              store.seal(payload),
              grantId ?? null,
              payload.uid ?? null,
              payload.userCode ?? null,
              expiresIn ?? null,
            ],
          );
        }),
      consume: async (id) => {
        const result = await store.db.query(
          `UPDATE chatgpt_oauth_artifacts SET consumed_at=extract(epoch from now())::bigint WHERE model=$1 AND id_hash=$2 AND consumed_at IS NULL AND expires_at>now() RETURNING id_hash`,
          [model, digest(id)],
        );
        if (!result.rows.length)
          throw new ConnectionError("CONNECTION_CODE_ALREADY_USED", 401);
      },
      destroy: async (id) => {
        await store.db.query(
          "DELETE FROM chatgpt_oauth_artifacts WHERE model=$1 AND id_hash=$2",
          [model, digest(id)],
        );
      },
      revokeByGrantId: async (grantId) => store.revokeGrant(grantId),
    };
  }
  async registerClient(
    ownerId: string,
    input: { name: string; redirectUris: string[] },
  ) {
    if (
      !input.name?.trim() ||
      input.name.length > 100 ||
      !Array.isArray(input.redirectUris) ||
      input.redirectUris.length < 1 ||
      input.redirectUris.length > 5
    )
      throw new ConnectionError("CONNECTION_INVALID_CLIENT");
    for (const value of input.redirectUris) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new ConnectionError("CONNECTION_INVALID_REDIRECT");
      }
      if (
        url.protocol !== "https:" ||
        url.hash ||
        url.username ||
        url.password ||
        value.includes("*") ||
        value.length > 2048
      )
        throw new ConnectionError("CONNECTION_INVALID_REDIRECT");
    }
    const clientId = randomUUID();
    const metadata = {
      client_id: clientId,
      client_name: input.name.trim(),
      redirect_uris: input.redirectUris,
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "web",
    };
    await this.db.query(
      "INSERT INTO chatgpt_oauth_clients(id,owner_id,metadata) VALUES($1,$2,$3::jsonb)",
      [clientId, ownerId, JSON.stringify(metadata)],
    );
    return { clientId, ...metadata };
  }
  async revoke(ownerId: string, id: string) {
    return transaction(this.db, async (tx) => {
      const row = (
        await tx.query(
          "SELECT grant_id FROM chatgpt_connections WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, ownerId],
        )
      ).rows[0];
      if (!row) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
      await tx.query(
        "UPDATE chatgpt_connections SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1",
        [id],
      );
      await tx.query("DELETE FROM chatgpt_oauth_artifacts WHERE grant_id=$1", [
        row.grant_id,
      ]);
    });
  }
  async revokeGrant(grantId: string) {
    return transaction(this.db, async (tx) => {
      await tx.query(
        "SELECT id FROM chatgpt_connections WHERE grant_id=$1 FOR UPDATE",
        [grantId],
      );
      await tx.query(
        "UPDATE chatgpt_connections SET revoked_at=coalesce(revoked_at,now()) WHERE grant_id=$1",
        [grantId],
      );
      await tx.query("DELETE FROM chatgpt_oauth_artifacts WHERE grant_id=$1", [
        grantId,
      ]);
    });
  }
}
