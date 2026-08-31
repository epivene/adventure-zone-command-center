import { pool as defaultPool } from "@workspace/db";

export type OwnerAccountCredentialRecord = {
  id: string;
  loginName: string;
  displayName: string;
  role: "owner";
  passwordHash: string;
  passwordSalt: string;
  enabled: boolean;
  sessionVersion: number;
};

export type OwnerAccountSessionRecord = Omit<
  OwnerAccountCredentialRecord,
  "passwordHash" | "passwordSalt"
>;

type QueryResult = { rows: Array<Record<string, any>> };
type Queryable = {
  query(text: string, values?: unknown[]): Promise<QueryResult>;
};
type OwnerClient = Queryable & { release(): void };
type OwnerPool = Queryable & { connect(): Promise<OwnerClient> };

function mapCredential(row: Record<string, unknown>): OwnerAccountCredentialRecord {
  return {
    id: String(row.id),
    loginName: String(row.login_name),
    displayName: String(row.display_name),
    role: "owner",
    passwordHash: String(row.password_hash),
    passwordSalt: String(row.password_salt),
    enabled: row.enabled === true,
    sessionVersion: Number(row.session_version),
  };
}

function mapSession(row: Record<string, unknown>): OwnerAccountSessionRecord {
  const credential = mapCredential({
    ...row,
    password_hash: "",
    password_salt: "",
  });
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...session } = credential;
  return session;
}

const credentialColumns = `
  id,
  login_name,
  display_name,
  role,
  password_hash,
  password_salt,
  enabled,
  session_version
`;

const sessionColumns = `
  id,
  login_name,
  display_name,
  role,
  enabled,
  session_version
`;

const legacyActorTables = ["assistant_conversations", "assistant_jobs", "lead_scout_runs"] as const;

async function adoptLegacyOwnerActors(client: Queryable, ownerId: string): Promise<void> {
  for (const tableName of legacyActorTables) {
    const existing = await client.query(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = $1
           AND column_name = 'actor_id'
       ) AS has_actor_id`,
      [tableName],
    );
    if (existing.rows[0]?.has_actor_id !== true) continue;
    await client.query(
      `UPDATE ${tableName} SET actor_id = $1 WHERE actor_id = ''`,
      [ownerId],
    );
  }
}

export class PostgresOwnerAccountRepository {
  constructor(
    private readonly pool: OwnerPool = defaultPool as unknown as OwnerPool,
  ) {}

  async findPrimary(): Promise<OwnerAccountCredentialRecord | null> {
    const result = await this.pool.query(
      `SELECT ${credentialColumns}
       FROM owner_accounts
       WHERE singleton_key = 'primary'
       LIMIT 1`,
    );
    return result.rows[0] ? mapCredential(result.rows[0]) : null;
  }

  async getActiveSession(ownerId: string): Promise<OwnerAccountSessionRecord | null> {
    const result = await this.pool.query(
      `SELECT ${sessionColumns}
       FROM owner_accounts
       WHERE id = $1::uuid
         AND singleton_key = 'primary'
         AND enabled = true
       LIMIT 1`,
      [ownerId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async createPrimary(input: {
    loginName: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<OwnerAccountCredentialRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('adventure-zone:primary-owner-account'))",
      );
      const existing = await client.query(
        `SELECT ${credentialColumns}
         FROM owner_accounts
         WHERE singleton_key = 'primary'
         LIMIT 1
         FOR UPDATE`,
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return mapCredential(existing.rows[0]);
      }

      const created = await client.query(
        `INSERT INTO owner_accounts
           (singleton_key, login_name, display_name, role, password_hash,
            password_salt, enabled, session_version, updated_at)
         VALUES ('primary', $1, $2, 'owner', $3, $4, true, 1, now())
         RETURNING ${credentialColumns}`,
        [
          input.loginName.trim(),
          input.displayName.trim(),
          input.passwordHash,
          input.passwordSalt,
        ],
      );
      const row = created.rows[0];
      if (!row) throw new Error("OWNER_ACCOUNT_CREATE_FAILED");
      const owner = mapCredential(row);
      await adoptLegacyOwnerActors(client, owner.id);
      await client.query("COMMIT");
      return owner;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async incrementSessionVersion(ownerId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE owner_accounts
       SET session_version = session_version + 1,
           updated_at = now()
       WHERE id = $1::uuid
         AND singleton_key = 'primary'
       RETURNING id`,
      [ownerId],
    );
    return result.rows.length > 0;
  }
}
