import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, expect, it } from "vitest";
import { DrizzlePlanningRepository } from "./planning-repository";
import type { PlanDraft } from "@workspace/api-zod";

const legId = "00000000-0000-4000-8000-000000000001";
const bookingId = "00000000-0000-4000-8000-000000000002";
const archivedId = "00000000-0000-4000-8000-000000000003";
const owner = { kind: "owner" as const, subject: "office" };
let pg: PGlite;
let db: ReturnType<typeof drizzle>;
let repo: DrizzlePlanningRepository;
const draft = (): PlanDraft => ({
  bookingId,
  legId,
  seasonYear: 2027,
  window: null,
  phases: {},
  requirements: {
    minimumCrew: null,
    roles: null,
    transportRequired: null,
    lodging: "unknown",
    lodgingReason: null,
  },
  crew: [],
  packageSetIds: [],
  transportResourceIds: [],
  lodging: [],
  splitGroupId: null,
});
beforeEach(async () => {
  pg = new PGlite();
  db = drizzle(pg);
  await pg.exec(`CREATE TABLE travel_legs(id uuid PRIMARY KEY,name text,archived_at timestamptz);
    CREATE TABLE bookings(id uuid PRIMARY KEY,travel_leg_id uuid,status text,name text);
    CREATE TABLE crew_workers(id uuid PRIMARY KEY,name text);
    CREATE TABLE resources(id uuid PRIMARY KEY,name text);
    CREATE TABLE package_templates(id uuid PRIMARY KEY,name text);
    CREATE TABLE boss_accounts(id uuid PRIMARY KEY,enabled boolean);
    INSERT INTO travel_legs VALUES('${legId}','Angel',null),('${archivedId}','Angelo','2026-01-01');
    INSERT INTO bookings VALUES('${bookingId}','${legId}','confirmed','Summer Fair');`);
  const migration = await readFile(
    new URL(
      "../../../../../lib/db/migrations/20261001_leg_planning.sql",
      import.meta.url,
    ),
    "utf8",
  );
  await pg.exec(migration);
  repo = new DrizzlePlanningRepository(db);
});
afterEach(async () => {
  await pg?.close();
});

it("starts with no plan and preserves the current booking and archived leg", async () => {
  expect(await repo.readBooking(bookingId, owner)).toBeNull();
  expect(await repo.readSeason(legId, 2027, owner)).toBeNull();
  expect(
    (
      await pg.query(
        "SELECT name,archived_at IS NOT NULL AS archived FROM travel_legs ORDER BY name",
      )
    ).rows,
  ).toEqual([
    { name: "Angel", archived: false },
    { name: "Angelo", archived: true },
  ]);
  expect((await pg.query("SELECT status FROM bookings")).rows).toEqual([
    { status: "confirmed" },
  ]);
  expect(
    (await pg.query("SELECT count(*)::int AS n FROM package_sets")).rows,
  ).toEqual([{ n: 0 }]);
  expect(
    (await pg.query("SELECT count(*)::int AS n FROM crew_workers")).rows,
  ).toEqual([{ n: 0 }]);
});
it("saves an incomplete draft without committing the assignment or customer status", async () => {
  const plan = await db.transaction((tx) =>
    repo.saveDraftIn(tx, draft(), null),
  );
  expect(plan.revision).toBe(1);
  expect(plan.committed).toBeNull();
  expect(
    (await repo.readBooking(bookingId, owner))?.draft.requirements.minimumCrew,
  ).toBeNull();
  expect(
    (await pg.query("SELECT status,travel_leg_id FROM bookings")).rows,
  ).toEqual([{ status: "confirmed", travel_leg_id: legId }]);
});
it("rejects stale revisions and create-only retries without replacing the current draft", async () => {
  await db.transaction((tx) => repo.saveDraftIn(tx, draft(), null));
  await expect(
    db.transaction((tx) =>
      repo.saveDraftIn(tx, { ...draft(), seasonYear: 2028 }, null),
    ),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  await expect(
    db.transaction((tx) => repo.saveDraftIn(tx, draft(), 0)),
  ).rejects.toMatchObject({ code: "STALE_REVISION" });
  expect((await repo.readBooking(bookingId, owner))?.draft.seasonYear).toBe(
    2027,
  );
  expect(
    (await db.transaction((tx) => repo.saveDraftIn(tx, draft(), 1))).revision,
  ).toBe(2);
});
it("enforces unique leg/season plans and existing physical references", async () => {
  await db.execute(
    sql`INSERT INTO leg_season_plans(leg_id,season_year,payload) VALUES(${legId}::uuid,2027,'{}')`,
  );
  await expect(
    db.execute(
      sql`INSERT INTO leg_season_plans(leg_id,season_year,payload) VALUES(${legId}::uuid,2027,'{}')`,
    ),
  ).rejects.toThrow();
  await expect(
    db.execute(
      sql`INSERT INTO package_set_members(set_id,resource_id) VALUES('00000000-0000-4000-8000-000000000099','00000000-0000-4000-8000-000000000098')`,
    ),
  ).rejects.toThrow();
  await expect(
    db.transaction((tx) =>
      repo.saveDraftIn(tx, { ...draft(), legId: "not-a-uuid" }, null),
    ),
  ).rejects.toThrow();
});
it("denies another leg before returning stored draft information", async () => {
  await db.transaction((tx) => repo.saveDraftIn(tx, draft(), null));
  await expect(
    repo.readBooking(bookingId, {
      kind: "manager",
      legId: archivedId,
      sessionVersion: 1,
    }),
  ).rejects.toMatchObject({ status: 403 });
});
