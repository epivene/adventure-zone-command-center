import { expect, it } from "vitest";
import { ensureLegPlanningSchemaBeforeListen } from "./leg-planning-required-startup";

it("fails closed when required planning constraints are missing", async () => {
  const pool = { query: async () => ({ rows: [{ ready: false }] }) };
  await expect(ensureLegPlanningSchemaBeforeListen({ pool })).rejects.toThrow(
    "LEG_PLANNING_SCHEMA_REQUIRED",
  );
});
it("accepts verified schema without seeding operational facts", async () => {
  let writes = 0;
  const pool = {
    query: async (text: string) => {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(text)) writes++;
      return { rows: [{ ready: true }] };
    },
  };
  await ensureLegPlanningSchemaBeforeListen({ pool });
  expect(writes).toBe(0);
});
it("applies the additive migration before exposing a new installation", async () => {
  let ready = false;
  const pool = { query: async () => ({ rows: [{ ready }] }) };
  await ensureLegPlanningSchemaBeforeListen({
    pool,
    applyMigration: async () => {
      ready = true;
    },
  });
  expect(ready).toBe(true);
});
