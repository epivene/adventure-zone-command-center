export const legPlanningEnabled = () =>
  process.env.LEG_PLANNING_ENABLED === "true";
export const legPlanningSchemaCheck = `SELECT
  NOT EXISTS(SELECT 1 FROM (VALUES ('leg_season_plans'),('crew_availability'),('package_sets'),('package_set_members'),('leg_event_plans'),('leg_plan_crew_commitments'),('leg_plan_splits'),('leg_plan_authorities'),('leg_plan_approval_requests'),('leg_plan_approval_decisions'),('leg_plan_mutation_receipts')) t(name) WHERE to_regclass(current_schema()||'.'||t.name) IS NULL)
  AND NOT EXISTS(SELECT 1 FROM (VALUES ('leg_season_plans_identity'),('crew_availability_window'),('package_set_members_identity'),('leg_plan_crew_window'),('leg_plan_crew_identity'),('leg_plan_split_distinct'),('leg_plan_receipt_identity')) t(name) WHERE NOT EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname=t.name))
  AND NOT EXISTS(SELECT 1 FROM (VALUES ('crew_availability_worker_window'),('package_set_members_resource'),('leg_event_plans_leg'),('leg_plan_crew_worker_window'),('leg_plan_splits_bookings'),('leg_plan_requests_bookings'),('leg_plan_decisions_request')) t(name) WHERE to_regclass(current_schema()||'.'||t.name) IS NULL)
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leg_plan_decision_immutable' AND tgrelid=to_regclass(current_schema()||'.leg_plan_approval_decisions'))
  AND to_regclass(current_schema()||'.outreach_allocation_mutex') IS NOT NULL
  AND to_regclass(current_schema()||'.outreach_write_receipts') IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM (VALUES ('leg_plan_crew_commitments'),('leg_event_plans'),('trips'),('trip_stops'),('trip_resource_assignments'),('bookings'),('booking_resource_assignments')) t(name) WHERE NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leg_planning_write_guard' AND tgrelid=to_regclass(current_schema()||'.'||t.name)))
  AND EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='leg_planning_receipt_validation' AND tgrelid=to_regclass(current_schema()||'.outreach_write_receipts')) AS ready`;
export async function ensureLegPlanningSchemaBeforeListen(options?: {
  pool?: { query(text: string): Promise<{ rows: Array<{ ready?: boolean }> }> };
  applyMigration?: () => Promise<void>;
}): Promise<void> {
  const pool = options?.pool ?? (await import("@workspace/db")).pool;
  const check = async () => {
    const result = await pool.query(legPlanningSchemaCheck);
    if (result.rows[0]?.ready !== true) return result;
    return pool.query(
      "SELECT EXISTS(SELECT 1 FROM outreach_allocation_mutex WHERE id=1) AS ready",
    );
  };
  let { rows } = await check();
  if (rows[0]?.ready !== true) {
    if (options?.applyMigration) await options.applyMigration();
    else if (!options?.pool) {
      const { loadActReviewMigrations, runActReviewMigrations } =
        await import("@workspace/db/migrations");
      const migrations = (await loadActReviewMigrations()).filter(
        (m) => m.name === "20261001_leg_planning.sql",
      );
      await runActReviewMigrations({ migrations });
    }
    ({ rows } = await check());
  }
  if (rows[0]?.ready !== true) throw new Error("LEG_PLANNING_SCHEMA_REQUIRED");
}
