import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { computerCallSessions } from "@/db/schema";
import {
  DrizzleComputerCallRepository,
  type CreateComputerCallIntentRecord,
} from "./computer-call-repository";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONTACT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PHONE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW = new Date("2026-09-02T12:00:00.000Z");

let client: PGlite;
let repository: DrizzleComputerCallRepository;

function intentInput(
  overrides: Partial<CreateComputerCallIntentRecord> = {},
): CreateComputerCallIntentRecord {
  return {
    ownerId: "owner",
    organizationId: ORGANIZATION_ID,
    contactId: CONTACT_ID,
    phoneId: PHONE_ID,
    callerIdSnapshot: "+15557654321",
    destinationNumberSnapshot: "+15551234567",
    intentExpiresAt: new Date("2026-09-02T12:02:00.000Z"),
    createdAt: NOW,
    ...overrides,
  };
}

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table organizations (id uuid primary key);
    create table contacts (id uuid primary key);
    create table contact_phones (id uuid primary key);
    create table computer_call_sessions (
      id uuid primary key default gen_random_uuid(),
      owner_id text not null,
      organization_id uuid not null references organizations(id),
      contact_id uuid not null references contacts(id),
      phone_id uuid not null references contact_phones(id),
      provider text not null,
      provider_call_sid text unique,
      direction text not null default 'outbound',
      method text not null default 'browser_voip',
      status text not null,
      caller_id_snapshot text not null,
      destination_number_snapshot text not null,
      intent_expires_at timestamptz not null,
      intent_consumed_at timestamptz,
      created_at timestamptz not null default now(),
      started_at timestamptz,
      answered_at timestamptz,
      ended_at timestamptz,
      updated_at timestamptz not null default now(),
      duration_seconds integer,
      error_code text,
      error_summary text
    );
    insert into organizations (id) values ('${ORGANIZATION_ID}');
    insert into contacts (id) values ('${CONTACT_ID}');
    insert into contact_phones (id) values ('${PHONE_ID}');
  `);
  const database = drizzle(client, { schema: { computerCallSessions } });
  repository = new DrizzleComputerCallRepository(database as never);
});

afterEach(async () => {
  await client.close();
});

describe("DrizzleComputerCallRepository", () => {
  it("creates an unconsumed two-minute call intent in created state", async () => {
    const created = await repository.createIntent(intentInput());

    expect(created).toEqual(expect.objectContaining({
      ownerId: "owner",
      provider: "twilio",
      providerCallSid: null,
      direction: "outbound",
      method: "browser_voip",
      status: "created",
      intentConsumedAt: null,
      intentExpiresAt: new Date("2026-09-02T12:02:00.000Z"),
    }));
  });

  it("returns sessions only to their owner", async () => {
    const created = await repository.createIntent(intentInput());

    expect(await repository.getSessionForOwner({ id: created.id, ownerId: "owner" }))
      .toEqual(created);
    expect(await repository.getSessionForOwner({ id: created.id, ownerId: "other" }))
      .toBeNull();
  });

  it("returns a retry only when the same caller and CallSid consume again", async () => {
    const created = await repository.createIntent(intentInput());
    const first = await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-first",
      callerIdentity: "owner",
      now: NOW,
    });
    const retry = await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-first",
      callerIdentity: "owner",
      now: new Date("2026-09-02T12:00:01.000Z"),
    });

    expect(first.kind).toBe("consumed");
    expect(retry).toEqual(first.kind === "consumed"
      ? { kind: "retry", session: first.session }
      : expect.unreachable());
  });

  it("rejects a different CallSid after binding", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-first",
      callerIdentity: "owner",
      now: NOW,
    });

    expect(await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-second",
      callerIdentity: "owner",
      now: NOW,
    })).toEqual({ kind: "already_bound" });
  });

  it("rejects an intent at or after its expiry", async () => {
    const created = await repository.createIntent(intentInput());

    expect(await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-expired",
      callerIdentity: "owner",
      now: new Date("2026-09-02T12:02:00.000Z"),
    })).toEqual({ kind: "expired" });
  });

  it("hides identity mismatches and leaves the intent unconsumed", async () => {
    const created = await repository.createIntent(intentInput());

    expect(await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-attacker",
      callerIdentity: "not-owner",
      now: NOW,
    })).toEqual({ kind: "not_found" });
    expect((await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-owner",
      callerIdentity: "owner",
      now: NOW,
    })).kind).toBe("consumed");
  });

  it("allows only one of two concurrent CallSids to bind", async () => {
    const created = await repository.createIntent(intentInput());

    const results = await Promise.all([
      repository.consumeIntent({
        id: created.id,
        providerCallSid: "CA-one",
        callerIdentity: "owner",
        now: NOW,
      }),
      repository.consumeIntent({
        id: created.id,
        providerCallSid: "CA-two",
        callerIdentity: "owner",
        now: NOW,
      }),
    ]);

    expect(results.map(({ kind }) => kind).sort()).toEqual(["already_bound", "consumed"]);
  });

  it("does not bind one provider CallSid to two intents", async () => {
    const first = await repository.createIntent(intentInput());
    const second = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: first.id,
      providerCallSid: "CA-unique",
      callerIdentity: "owner",
      now: NOW,
    });

    expect(await repository.consumeIntent({
      id: second.id,
      providerCallSid: "CA-unique",
      callerIdentity: "owner",
      now: NOW,
    })).toEqual({ kind: "already_bound" });
    expect(await repository.getSessionForOwner({ id: second.id, ownerId: "owner" }))
      .toEqual(expect.objectContaining({ providerCallSid: null, intentConsumedAt: null }));
  });

  it("maps a concurrent duplicate CallSid loser without leaking a database error", async () => {
    const first = await repository.createIntent(intentInput());
    const second = await repository.createIntent(intentInput());
    const queryClient = client as unknown as {
      query: (...args: unknown[]) => Promise<unknown>;
    };
    const originalQuery = queryClient.query.bind(queryClient);
    let updateNumber = 0;
    let releaseFirst!: () => void;
    let finishFirst!: () => void;
    const firstMayRun = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstFinished = new Promise<void>((resolve) => { finishFirst = resolve; });

    queryClient.query = async (...args: unknown[]) => {
      const queryText = typeof args[0] === "string" ? args[0] : "";
      if (queryText.includes('update "computer_call_sessions"')) {
        updateNumber += 1;
        if (updateNumber === 1) {
          await firstMayRun;
          try {
            return await originalQuery(...args);
          } finally {
            finishFirst();
          }
        }
        if (updateNumber === 2) {
          releaseFirst();
          await firstFinished;
          throw Object.assign(
            new Error(
              'duplicate key value violates unique constraint "computer_call_sessions_provider_call_sid_key"',
            ),
            {
              code: "23505",
              table: "computer_call_sessions",
              constraint: "computer_call_sessions_provider_call_sid_key",
            },
          );
        }
      }
      return originalQuery(...args);
    };

    try {
      const results = await Promise.all([
        repository.consumeIntent({
          id: first.id,
          providerCallSid: "CA-concurrent-unique",
          callerIdentity: "owner",
          now: NOW,
        }),
        repository.consumeIntent({
          id: second.id,
          providerCallSid: "CA-concurrent-unique",
          callerIdentity: "owner",
          now: NOW,
        }),
      ]);

      expect(results.map(({ kind }) => kind).sort()).toEqual(["already_bound", "consumed"]);
    } finally {
      queryClient.query = originalQuery;
    }

    const sessions = await Promise.all([
      repository.getSessionForOwner({ id: first.id, ownerId: "owner" }),
      repository.getSessionForOwner({ id: second.id, ownerId: "owner" }),
    ]);
    expect(sessions.filter((session) => session?.providerCallSid === "CA-concurrent-unique"))
      .toHaveLength(1);
  });

  it("keeps the first terminal status update idempotently", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-terminal",
      callerIdentity: "owner",
      now: NOW,
    });
    const completedAt = new Date("2026-09-02T12:01:30.000Z");
    const completed = await repository.updateProviderStatus({
      providerCallSid: "CA-terminal",
      status: "completed",
      occurredAt: completedAt,
      durationSeconds: 90,
      errorCode: null,
      errorSummary: null,
    });
    const duplicate = await repository.updateProviderStatus({
      providerCallSid: "CA-terminal",
      status: "failed",
      occurredAt: new Date("2026-09-02T12:01:40.000Z"),
      durationSeconds: 100,
      errorCode: "late-error",
      errorSummary: "late callback",
    });

    expect(completed).toEqual(expect.objectContaining({
      status: "completed",
      endedAt: completedAt,
      durationSeconds: 90,
    }));
    expect(duplicate).toEqual(completed);
  });
});
