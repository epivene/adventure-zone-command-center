import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { incomingCallAvailabilityLeases } from "@/db/schema";
import { DrizzleIncomingAvailabilityRepository } from "./incoming-availability-repository";

const NOW = new Date("2026-09-02T20:35:00.000Z");
let client: PGlite;
let repository: DrizzleIncomingAvailabilityRepository;

beforeEach(async () => {
  client = new PGlite();
  await client.exec(`
    create table incoming_call_availability_leases (
      id uuid primary key,
      owner_id text not null unique,
      client_identity text not null unique,
      lease_token_hash text not null,
      browser_session_id text not null,
      expires_at timestamptz not null,
      heartbeat_at timestamptz not null,
      active_inbound_session_id uuid,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
  `);
  repository = new DrizzleIncomingAvailabilityRepository(
    drizzle(client, { schema: { incomingCallAvailabilityLeases } }) as never,
  );
});

afterEach(async () => client.close());

describe("DrizzleIncomingAvailabilityRepository", () => {
  async function seedLease(expiresAt: string, activeInboundSessionId: string | null = null) {
    await client.query(`
      insert into incoming_call_availability_leases
        (id, owner_id, client_identity, lease_token_hash, browser_session_id, expires_at, heartbeat_at, active_inbound_session_id)
      values
        ('11111111-1111-4111-8111-111111111111', 'owner', 'stale-identity', 'stale-hash', 'stale-browser', '${expiresAt}', '2026-09-02T20:33:00.000Z', ${activeInboundSessionId ? `'${activeInboundSessionId}'` : "null"})
    `);
  }

  const nextLease = {
    leaseId: "22222222-2222-4222-8222-222222222222",
    ownerId: "owner",
    clientIdentity: "new-identity",
    leaseTokenHash: "new-hash",
    browserSessionId: "new-browser",
    expiresAt: new Date("2026-09-02T20:40:00.000Z"),
  };

  it("replaces an expired availability lease without takeover", async () => {
    await seedLease("2026-09-02T20:34:00.000Z");

    const acquired = await repository.acquire(nextLease, NOW, false);

    expect(acquired).toBe(true);
    const rows = await client.query<{ id: string; client_identity: string }>(
      "select id, client_identity from incoming_call_availability_leases where owner_id = 'owner'",
    );
    expect(rows.rows).toEqual([{
      id: "22222222-2222-4222-8222-222222222222",
      client_identity: "new-identity",
    }]);
  });

  it("does not replace an unexpired availability lease without takeover", async () => {
    await seedLease("2026-09-02T20:36:00.000Z");

    expect(await repository.acquire(nextLease, NOW, false)).toBe(false);
    const rows = await client.query<{ id: string }>(
      "select id from incoming_call_availability_leases where owner_id = 'owner'",
    );
    expect(rows.rows).toEqual([{ id: "11111111-1111-4111-8111-111111111111" }]);
  });

  it("allows takeover of an unexpired lease when no call is active", async () => {
    await seedLease("2026-09-02T20:36:00.000Z");

    expect(await repository.acquire(nextLease, NOW, true)).toBe(true);
  });

  it("refuses takeover while an inbound call owns the lease", async () => {
    await seedLease(
      "2026-09-02T20:36:00.000Z",
      "33333333-3333-4333-8333-333333333333",
    );

    expect(await repository.acquire(nextLease, NOW, true)).toBe(false);
  });
});
