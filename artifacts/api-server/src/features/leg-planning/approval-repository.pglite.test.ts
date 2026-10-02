import { afterEach, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { planningDatabase } from "./planning-test-database";
import { actors, completeFacts, ids } from "./planning-fixtures";
import { planningFingerprint } from "./planning-facts";
import { DrizzlePlanningRepository } from "./planning-repository";
const opened: Array<Awaited<ReturnType<typeof planningDatabase>>> = [];
afterEach(async () => {
  for (const d of opened.splice(0)) await d.pg.close();
  vi.unstubAllGlobals();
});
it("appends attributed decisions, rejects repeated decisions and preserves immutable history", async () => {
  const d = await planningDatabase();
  const network = vi.fn(() => {
    throw new Error("Approval must not call a provider");
  });
  vi.stubGlobal("fetch", network);
  opened.push(d);
  const f = completeFacts();
  const fingerprint = planningFingerprint(f);
  const requestId = "00000000-0000-4000-8000-000000000013";
  await d.db.execute(
    sql`INSERT INTO leg_plan_approval_requests(id,parent_leg_id,type,booking_ids,plan_fingerprint) VALUES(${requestId}::uuid,${ids.leg}::uuid,'extra_pirates',${JSON.stringify([ids.booking])}::jsonb,${fingerprint})`,
  );
  const repo = new DrizzlePlanningRepository(d.db);
  const input = {
    decision: "approved" as const,
    reason: "Reviewed all evidence",
    strategicAcknowledgement: false,
  };
  const result = await d.db.transaction((tx) =>
    repo.appendDecisionIn(tx, requestId, actors.dave, input, [f]),
  );
  expect(result.actor).toEqual(actors.dave);
  expect(result.planFingerprint).toBe(fingerprint);
  await expect(
    d.db.transaction((tx) =>
      repo.appendDecisionIn(tx, requestId, actors.dave, input, [f]),
    ),
  ).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
  await expect(
    d.pg.exec(
      `UPDATE leg_plan_approval_decisions SET reason='changed' WHERE id='${result.id}'`,
    ),
  ).rejects.toThrow();
  await d.db.transaction((tx) =>
    repo.appendDecisionIn(
      tx,
      requestId,
      actors.dave,
      { ...input, decision: "revoked" },
      [f],
    ),
  );
  expect(
    (
      await d.pg.query(
        "SELECT count(*)::int AS n FROM leg_plan_approval_decisions",
      )
    ).rows,
  ).toEqual([{ n: 2 }]);
  expect(network).not.toHaveBeenCalled();
});
