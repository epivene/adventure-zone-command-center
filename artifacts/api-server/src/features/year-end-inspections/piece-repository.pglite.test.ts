import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL ||= "postgres://postgres:postgres@127.0.0.1:5432/test";
});

import * as yearEndSchema from "@workspace/db/year-end-inspection-schema";
import { YEAR_END_INSPECTION_SCHEMA_SQL } from "@/db/year-end-inspection-required-startup";
import { DrizzlePieceRepository } from "./piece-repository";

const clients: PGlite[] = [];
const legId = "10000000-0000-4000-8000-000000000001";
const secondLegId = "10000000-0000-4000-8000-000000000002";
const firstResourceId = "20000000-0000-4000-8000-000000000001";
const secondResourceId = "20000000-0000-4000-8000-000000000002";

async function setup() {
  const client = new PGlite();
  clients.push(client);
  await client.exec(`
    CREATE TABLE travel_legs (
      id uuid PRIMARY KEY, name text NOT NULL, color text NOT NULL DEFAULT '#000000',
      sort_order integer NOT NULL, archived_at timestamptz
    );
    CREATE TABLE resources (
      id uuid PRIMARY KEY, code text NOT NULL, name text NOT NULL, category text NOT NULL,
      status text NOT NULL DEFAULT 'available'
    );
    INSERT INTO travel_legs (id, name, sort_order) VALUES
      ('${legId}', 'Leg One', 1), ('${secondLegId}', 'Leg Two', 2);
    INSERT INTO resources (id, code, name, category) VALUES
      ('${firstResourceId}', 'WP', 'Warrior Playground', 'inflatable'),
      ('${secondResourceId}', 'AZ', 'Adventure Zone', 'inflatable');
  `);
  await client.exec(YEAR_END_INSPECTION_SCHEMA_SQL);
  return new DrizzlePieceRepository(drizzle(client, { schema: yearEndSchema }) as never);
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

describe("DrizzlePieceRepository", () => {
  it("keeps complete attraction-composition history when a piece is regrouped", async () => {
    const repository = await setup();
    const piece = await repository.create({
      code: "AZ-017",
      name: "Front wall section",
      pieceType: "inflatable_component",
      currentLegId: legId,
      storageLocation: "Trailer bay 2",
      identityNotes: null,
      lifecycleStatus: "active",
      resourceId: null,
    }, "owner:1");

    await repository.assignToResource(piece.id, firstResourceId, "owner:1", "Initial build");
    await repository.assignToResource(piece.id, secondResourceId, "owner:1", "Regrouped for 2027");

    const result = await repository.get(piece.id);
    expect(result?.currentResourceId).toBe(secondResourceId);
    expect(result?.assignmentHistory).toEqual([
      expect.objectContaining({ resourceId: firstResourceId, reason: "Initial build", removedAt: expect.any(Date) }),
      expect.objectContaining({ resourceId: secondResourceId, reason: "Regrouped for 2027", removedAt: null }),
    ]);
  });

  it("supports more than the estimated 58 pieces without a fixed limit", async () => {
    const repository = await setup();
    for (let index = 1; index <= 60; index += 1) {
      await repository.create({
        code: `P-${String(index).padStart(3, "0")}`,
        name: `Piece ${index}`,
        pieceType: "inflatable_component",
        currentLegId: legId,
        storageLocation: null,
        identityNotes: null,
        lifecycleStatus: "active",
        resourceId: null,
      }, "owner:1");
    }
    expect(await repository.list({ legId })).toHaveLength(60);
  });

  it("records cross-leg transfers and preserves archived pieces", async () => {
    const repository = await setup();
    const piece = await repository.create({
      code: "SPARE-1", name: "Spare step", pieceType: "inflatable_component",
      currentLegId: legId, storageLocation: null, identityNotes: null,
      lifecycleStatus: "stored_spare", resourceId: null,
    }, "owner:1");
    await repository.transferLeg(piece.id, secondLegId, "owner:1");
    await repository.archive(piece.id, "owner:1");

    expect(await repository.list({ legId: secondLegId })).toHaveLength(0);
    expect(await repository.get(piece.id)).toMatchObject({ currentLegId: secondLegId, archivedAt: expect.any(Date) });
  });
});
