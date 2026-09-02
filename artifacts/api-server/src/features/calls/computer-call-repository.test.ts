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

  it.each([
    ["busy", null, 0],
    ["no-answer", undefined, 0],
    ["failed", -5, 0],
    ["completed", 17, 17],
  ] as const)(
    "persists complete timing for direct %s terminal status",
    async (status, durationSeconds, expectedDuration) => {
      const created = await repository.createIntent(intentInput());
      await repository.consumeIntent({
        id: created.id,
        providerCallSid: `CA-direct-${status}`,
        callerIdentity: "owner",
        now: NOW,
      });
      const endedAt = new Date("2026-09-02T12:00:30.000Z");

      const terminal = await repository.updateProviderStatus({
        providerCallSid: `CA-direct-${status}`,
        status,
        occurredAt: endedAt,
        durationSeconds,
      });

      expect(terminal).toEqual(expect.objectContaining({
        status,
        startedAt: NOW,
        answeredAt: null,
        endedAt,
        durationSeconds: expectedDuration,
      }));
    },
  );

  it("preserves authoritative timestamps across the normal provider lifecycle", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-lifecycle",
      callerIdentity: "owner",
      now: NOW,
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-lifecycle",
      status: "queued",
      occurredAt: new Date("2026-09-02T12:00:05.000Z"),
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-lifecycle",
      status: "ringing",
      occurredAt: new Date("2026-09-02T12:00:10.000Z"),
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-lifecycle",
      status: "in-progress",
      occurredAt: new Date("2026-09-02T12:00:15.000Z"),
    });

    const completed = await repository.updateProviderStatus({
      providerCallSid: "CA-lifecycle",
      status: "completed",
      occurredAt: new Date("2026-09-02T12:00:45.000Z"),
      durationSeconds: 30,
    });

    expect(completed).toEqual(expect.objectContaining({
      status: "completed",
      startedAt: NOW,
      answeredAt: new Date("2026-09-02T12:00:15.000Z"),
      endedAt: new Date("2026-09-02T12:00:45.000Z"),
      durationSeconds: 30,
    }));
  });

  it("ignores out-of-order active and late callbacks", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-out-of-order",
      callerIdentity: "owner",
      now: NOW,
    });
    const connected = await repository.updateProviderStatus({
      providerCallSid: "CA-out-of-order",
      status: "in-progress",
      occurredAt: new Date("2026-09-02T12:00:20.000Z"),
    });
    const lateRinging = await repository.updateProviderStatus({
      providerCallSid: "CA-out-of-order",
      status: "ringing",
      occurredAt: new Date("2026-09-02T12:00:25.000Z"),
    });

    expect(lateRinging).toEqual(connected);

    const completed = await repository.updateProviderStatus({
      providerCallSid: "CA-out-of-order",
      status: "completed",
      occurredAt: new Date("2026-09-02T12:01:00.000Z"),
    });
    const lateQueued = await repository.updateProviderStatus({
      providerCallSid: "CA-out-of-order",
      status: "queued",
      occurredAt: new Date("2026-09-02T12:01:05.000Z"),
    });

    expect(completed).toEqual(expect.objectContaining({
      status: "completed",
      startedAt: NOW,
      answeredAt: new Date("2026-09-02T12:00:20.000Z"),
      endedAt: new Date("2026-09-02T12:01:00.000Z"),
      durationSeconds: 40,
    }));
    expect(lateQueued).toEqual(completed);
  });

  it("stores an unknown status for review without locking out a later known status", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-unknown-recovery",
      callerIdentity: "owner",
      now: NOW,
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-recovery",
      status: "queued",
      occurredAt: new Date("2026-09-02T12:00:05.000Z"),
    });

    const unknown = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-recovery",
      status: "unknown",
      occurredAt: new Date("2026-09-02T12:00:06.000Z"),
      errorSummary: "Unknown provider status: future-state",
    });

    expect(unknown).toEqual(expect.objectContaining({
      status: "unknown",
      startedAt: NOW,
      errorSummary: "Unknown provider status: future-state",
    }));

    const ringing = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-recovery",
      status: "ringing",
      occurredAt: new Date("2026-09-02T12:00:07.000Z"),
      errorSummary: null,
    });
    expect(ringing).toEqual(expect.objectContaining({
      status: "ringing",
      startedAt: NOW,
      errorSummary: null,
    }));
  });

  it("does not regress an answered call after an intervening unknown status", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-unknown-after-answer",
      callerIdentity: "owner",
      now: NOW,
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-answer",
      status: "in-progress",
      occurredAt: new Date("2026-09-02T12:00:10.000Z"),
    });
    const unknown = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-answer",
      status: "unknown",
      occurredAt: new Date("2026-09-02T12:00:11.000Z"),
      errorSummary: "Unknown provider status: future-state",
    });

    const delayedQueued = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-answer",
      status: "queued",
      occurredAt: new Date("2026-09-02T12:00:12.000Z"),
    });

    expect(unknown).toEqual(expect.objectContaining({
      status: "unknown",
      startedAt: NOW,
      answeredAt: new Date("2026-09-02T12:00:10.000Z"),
      errorSummary: "Unknown provider status: future-state",
    }));
    expect(delayedQueued).toEqual(unknown);
  });

  it("does not regress a started call to created after an intervening unknown status", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-unknown-after-queued",
      callerIdentity: "owner",
      now: NOW,
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-queued",
      status: "queued",
      occurredAt: new Date("2026-09-02T12:00:05.000Z"),
    });
    const unknown = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-queued",
      status: "unknown",
      occurredAt: new Date("2026-09-02T12:00:06.000Z"),
      errorSummary: "Unknown provider status: future-state",
    });

    const delayedCreated = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-queued",
      status: "created",
      occurredAt: new Date("2026-09-02T12:00:07.000Z"),
    });

    expect(delayedCreated).toEqual(unknown);
    expect(delayedCreated).toEqual(expect.objectContaining({
      status: "unknown",
      startedAt: NOW,
    }));
  });

  it("does not regress a ringing call after an intervening unknown status", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-unknown-after-ringing",
      callerIdentity: "owner",
      now: NOW,
    });
    await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-ringing",
      status: "ringing",
      occurredAt: new Date("2026-09-02T12:00:05.000Z"),
    });
    const unknown = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-ringing",
      status: "unknown",
      occurredAt: new Date("2026-09-02T12:00:06.000Z"),
      errorSummary: "Unknown provider status: future-state",
    });

    const delayedQueued = await repository.updateProviderStatus({
      providerCallSid: "CA-unknown-after-ringing",
      status: "queued",
      occurredAt: new Date("2026-09-02T12:00:07.000Z"),
    });

    expect(delayedQueued).toEqual(unknown);
    expect(delayedQueued).toEqual(expect.objectContaining({
      status: "unknown",
      startedAt: NOW,
    }));
  });

  it("reports a direct unknown without inventing lifecycle timing and still accepts a terminal outcome", async () => {
    const created = await repository.createIntent(intentInput());
    await repository.consumeIntent({
      id: created.id,
      providerCallSid: "CA-direct-unknown",
      callerIdentity: "owner",
      now: NOW,
    });
    const unknown = await repository.updateProviderStatus({
      providerCallSid: "CA-direct-unknown",
      status: "unknown",
      occurredAt: new Date("2026-09-02T12:00:05.000Z"),
      errorSummary: "Unknown provider status: future-state",
    });

    const lateCreated = await repository.updateProviderStatus({
      providerCallSid: "CA-direct-unknown",
      status: "created",
      occurredAt: new Date("2026-09-02T12:00:06.000Z"),
    });
    expect(lateCreated).toEqual(unknown);
    expect(unknown).toEqual(expect.objectContaining({
      status: "unknown",
      startedAt: null,
      answeredAt: null,
      errorSummary: "Unknown provider status: future-state",
    }));

    const failed = await repository.updateProviderStatus({
      providerCallSid: "CA-direct-unknown",
      status: "failed",
      occurredAt: new Date("2026-09-02T12:00:30.000Z"),
      errorCode: "provider-failure",
      errorSummary: "Provider rejected the call",
    });
    const lateCompleted = await repository.updateProviderStatus({
      providerCallSid: "CA-direct-unknown",
      status: "completed",
      occurredAt: new Date("2026-09-02T12:00:40.000Z"),
      durationSeconds: 35,
    });

    expect(failed).toEqual(expect.objectContaining({
      status: "failed",
      startedAt: NOW,
      answeredAt: null,
      endedAt: new Date("2026-09-02T12:00:30.000Z"),
      durationSeconds: 0,
      errorCode: "provider-failure",
    }));
    expect(lateCompleted).toEqual(failed);
  });
});
