import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as coverageSchema from "@workspace/db/event-date-coverage-schema";
import { EventDateRepository } from "./event-date-repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const clients: PGlite[] = [];
let client: PGlite;
let repository: EventDateRepository;

beforeEach(async () => {
  client = new PGlite();
  clients.push(client);
  await client.exec(`
    CREATE TABLE organizations (id uuid PRIMARY KEY, name text NOT NULL);
    INSERT INTO organizations (id, name) VALUES ('${organizationId}', 'River Days');
  `);
  const migration = await readFile(
    new URL("../../../../../lib/db/migrations/20260921_event_date_coverage.sql", import.meta.url),
    "utf8",
  );
  await client.exec(migration);
  repository = new EventDateRepository(drizzle(client, { schema: coverageSchema }));
});

afterEach(async () => {
  await Promise.all(clients.splice(0).map((entry) => entry.close()));
});

const baseFact = {
  organizationId,
  startsOn: "2027-09-05",
  endsOn: "2027-09-07",
  status: "confirmed" as const,
  recurrenceRule: null,
  rationale: "Published by the organizer",
  sourceKind: "web" as const,
  sourceTitle: "Official event site",
  sourceUrl: "https://example.test/dates",
  sourceRecordType: null,
  sourceRecordId: null,
  sourcePointers: [],
  researchedAt: new Date("2026-09-21T12:00:00Z"),
  verifiedAt: new Date("2026-09-21T12:00:00Z"),
  createdBy: "owner-1",
};

describe("EventDateRepository", () => {
  it("creates a fact and lists active facts in one bulk lookup", async () => {
    const created = await repository.supersedeActiveFact(baseFact);

    const active = await repository.listActiveFacts([organizationId]);
    expect(active.get(organizationId)).toEqual([created]);
    expect(await repository.listFacts(organizationId)).toEqual([created]);
  });

  it("transactionally supersedes the active fact and retains history", async () => {
    const first = await repository.supersedeActiveFact(baseFact);
    const second = await repository.supersedeActiveFact({
      ...baseFact,
      startsOn: "2027-09-12",
      endsOn: "2027-09-14",
      rationale: "Organizer corrected the weekend",
    });

    const history = await repository.listFacts(organizationId);
    expect(history).toHaveLength(2);
    expect(history.find((fact) => fact.id === first.id)).toMatchObject({
      active: false,
      supersededById: second.id,
    });
    expect(history.find((fact) => fact.id === second.id)).toMatchObject({
      active: true,
      supersededById: null,
    });
  });

  it("stores review candidates without replacing the effective fact", async () => {
    const active = await repository.supersedeActiveFact(baseFact);
    const review = await repository.markNeedsReview({
      ...baseFact,
      startsOn: "2027-09-19",
      endsOn: null,
      rationale: "Two official-looking sources disagree",
    });

    expect(review).toMatchObject({ status: "needs_review", active: false });
    expect((await repository.listActiveFacts([organizationId])).get(organizationId))
      .toEqual([active]);
  });

  it("atomically retains an active fact when a worker proposes a conflicting date", async () => {
    const active = await repository.supersedeActiveFact(baseFact);
    const proposed = await repository.applyWithoutSupersedingConflict({
      ...baseFact,
      startsOn: "2027-09-19",
      endsOn: null,
      rationale: "New internal evidence",
    });

    expect(proposed).toMatchObject({ status: "needs_review", active: false });
    expect(proposed.rationale).toContain("Conflicts with active confirmed fact 2027-09-05 to 2027-09-07");
    expect((await repository.listActiveFacts([organizationId])).get(organizationId)).toEqual([active]);
  });

  it("relies on the unique active constraint to reject conflicting direct writes", async () => {
    await repository.supersedeActiveFact(baseFact);

    await expect(client.query(`
      INSERT INTO event_date_facts (
        organization_id, starts_on, status, rationale, source_kind, source_title, active
      ) VALUES (
        '${organizationId}', '2027-10-01', 'confirmed', 'Conflict', 'web', 'Other', true
      )
    `)).rejects.toThrow();
    expect(await repository.listFacts(organizationId)).toHaveLength(1);
  });
});
