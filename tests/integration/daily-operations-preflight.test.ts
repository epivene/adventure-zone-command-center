import { existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(import.meta.dirname, "../..");
const preflightScript = path.join(
  projectRoot,
  "scripts/preflight-daily-operations-migration.sh",
);
const temporaryRoots: string[] = [];
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bashExecutable =
  process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";

async function executable(filePath: string, source: string) {
  await writeFile(filePath, source, { mode: 0o700 });
  await chmod(filePath, 0o700);
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "daily-operations-preflight-"));
  temporaryRoots.push(root);
  const binaryDirectory = path.join(root, "bin");
  await mkdir(binaryDirectory);
  await executable(
    path.join(binaryDirectory, "psql"),
    `#!/usr/bin/env bash
set -euo pipefail
case "$*" in
  *"to_regclass('drizzle.__drizzle_migrations')"*)
    printf '%s\\n' "\${MIGRATION_TABLE_EXISTS:-t}"
    ;;
  *"FROM drizzle.__drizzle_migrations"*)
    printf '%s\\n' "\${MIGRATION_RECORD_COUNT:-0}"
    ;;
  *"FROM pg_index"*)
    if [[ "\${MISSING_RESOURCES_CODE_UNIQUE:-0}" == "1" ]] &&
       [[ "$*" == *"resources_code_unique"* ]]; then
      printf '16\\n'
    elif [[ "\${PARTIAL_EXPECTED_INDEX:-0}" == "1" ]] &&
         [[ "$*" == *"pg_index.indpred IS NULL"* ]]; then
      printf '16\\n'
    elif [[ "\${EXPRESSION_EXPECTED_INDEX:-0}" == "1" ]] &&
         [[ "$*" == *"pg_index.indexprs IS NULL"* ]]; then
      printf '16\\n'
    elif [[ "\${NON_BTREE_EXPECTED_INDEX:-0}" == "1" ]] &&
         [[ "$*" == *"pg_am.amname = expected_indexes.access_method"* ]]; then
      printf '16\\n'
    else
      printf '%s\\n' "\${EXPECTED_INDEX_DEFINITION_COUNT:-17}"
    fi
    ;;
  *"FROM pg_constraint"*)
    if [[ "$*" == *"WITH expected_foreign_keys"* ]]; then
      printf '%s\\n' "\${EXPECTED_FOREIGN_KEY_DEFINITION_COUNT:-12}"
    elif [[ "$*" == *"WITH expected_checks"* ]]; then
      if [[ "\${WEAKENED_EXPECTED_CHECK:-0}" == "1" ]] &&
         [[ "$*" == *"expected_checks.normalized_expression"* ]]; then
        printf '17\\n'
      else
        printf '%s\\n' "\${EXPECTED_CHECK_DEFINITION_COUNT:-18}"
      fi
    elif [[ "$*" == *"WITH expected_constraints"* ]]; then
      if [[ "\${SIMULATE_CATALOG_TRUNCATION:-0}" == "1" ]] &&
         [[ "$*" != *"left(expected_constraints.constraint_name, 63)"* ]]; then
        printf '34\\n'
      elif [[ "\${MISSING_RESOURCE_LEG_FK:-0}" == "1" ]] &&
           [[ "$*" == *"resources_normal_travel_leg_id_travel_legs_id_fk"* ]]; then
        printf '37\\n'
      elif [[ "\${MISSING_BOOKING_TOTAL_CHECK:-0}" == "1" ]] &&
           [[ "$*" == *"bookings_physical_attraction_total_nonnegative"* ]]; then
        printf '37\\n'
      else
        printf '%s\\n' "\${EXPECTED_CONSTRAINT_COUNT:-38}"
      fi
    else
      printf '%s\\n' "\${BOOKING_CONSTRAINT_COLLISION_COUNT:-0}"
    fi
    ;;
  *"FROM pg_class"*)
    if [[ "\${EXPLICIT_INDEX_COLLISION:-0}" == "1" ]] &&
       [[ "$*" == *"resources_code_unique"* ]]; then
      printf '1\\n'
    else
      printf '%s\\n' "\${TARGET_RELATION_COUNT:-0}"
    fi
    ;;
  *"FROM pg_type"*)
    if [[ "\${TABLE_TYPE_COLLISION:-0}" == "1" ]] &&
       [[ "$*" == *"package_templates"* ]]; then
      printf '1\\n'
    else
      printf '%s\\n' "\${TARGET_TYPE_COUNT:-0}"
    fi
    ;;
  *"FROM information_schema.tables"*)
    printf '%s\\n' "\${TARGET_TABLE_COUNT:-0}"
    ;;
  *"FROM information_schema.columns"*)
    if [[ "$*" == *"WITH expected_columns"* ]]; then
      if [[ "\${MISSING_EXPECTED_TABLE_COLUMN:-0}" == "1" ]]; then
        printf '55\\n'
      else
        printf '%s\\n' "\${EXPECTED_COLUMN_DEFINITION_COUNT:-56}"
      fi
    elif [[ "$*" == *"data_type"* ]]; then
      printf '%s\\n' "\${BOOKING_COLUMN_DEFINITION_COUNT:-\${BOOKING_COLUMN_COUNT:-0}}"
    else
      printf '%s\\n' "\${BOOKING_COLUMN_COUNT:-0}"
    fi
    ;;
  *"to_regclass('public.package_templates')"*)
    printf '%s\\n' "\${PACKAGE_TABLE_EXISTS:-f}"
    ;;
  *"to_regclass('public.resources')"*)
    printf '%s\\n' "\${RESOURCE_TABLE_EXISTS:-f}"
    ;;
  *"FROM package_templates"*)
    printf '%s\\n' "\${INCOMPATIBLE_PACKAGE_COUNT:-0}"
    ;;
  *"FROM resources"*)
    printf '%s\\n' "\${INCOMPATIBLE_RESOURCE_COUNT:-0}"
    ;;
  *)
    printf 'Unexpected preflight query: %s\\n' "$*" >&2
    exit 71
    ;;
esac
`,
  );

  const existingPath = Object.entries(process.env).find(
    ([key]) => key.toLowerCase() === "path",
  )?.[1];
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== "path"),
  );

  return {
    env: {
      ...inheritedEnvironment,
      NODE_ENV: process.env.NODE_ENV,
      PATH: `${binaryDirectory}${path.delimiter}${existingPath ?? ""}`,
      DATABASE_URL: "postgresql://preflight@example.test/adventure_zone",
    },
  };
}

function runPreflight(environment: NodeJS.ProcessEnv) {
  return spawnSync(bashExecutable, [preflightScript], {
    env: environment,
    encoding: "utf8",
  });
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("daily operations migration preflight", () => {
  it("allows a clean 0006 database with no 0007 migration record or target schema", async () => {
    const context = await fixture();

    const result = runPreflight(context.env);

    expect(result.status, result.stderr).toBe(0);
  });

  it("rejects a compatible target relation when 0007 is not recorded", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      PACKAGE_TABLE_EXISTS: "t",
      TARGET_RELATION_COUNT: "1",
      TARGET_TABLE_COUNT: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("partial migration or schema collision");
    expect(result.stderr).toContain("database restore");
  });

  it("rejects an unapplied explicit-index-name collision", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      EXPLICIT_INDEX_COLLISION: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("partial migration or schema collision");
  });

  it("rejects an unapplied target table-type collision", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      TABLE_TYPE_COLLISION: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("table type");
  });

  it("rejects an unapplied booking-check constraint collision", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      BOOKING_CONSTRAINT_COLLISION_COUNT: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("booking constraint");
  });

  it("rejects incompatible stable rows after 0007 is recorded", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      PACKAGE_TABLE_EXISTS: "t",
      RESOURCE_TABLE_EXISTS: "t",
      INCOMPATIBLE_PACKAGE_COUNT: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain(
      "1 stable package code row(s) have incompatible names or base counts",
    );
  });

  it("rejects a recorded 0007 with the wrong booking column type", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      EXPECTED_COLUMN_DEFINITION_COUNT: "55",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("56 column definitions");
  });

  it("rejects a recorded 0007 with an index on the wrong columns", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      EXPECTED_INDEX_DEFINITION_COUNT: "16",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("17 index definitions");
  });

  it.each([
    ["partial", { PARTIAL_EXPECTED_INDEX: "1" }],
    ["expression", { EXPRESSION_EXPECTED_INDEX: "1" }],
    ["non-btree", { NON_BTREE_EXPECTED_INDEX: "1" }],
  ])("rejects a recorded 0007 with a %s expected index", async (_, drift) => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      ...drift,
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("17 index definitions");
  });

  it("rejects a recorded 0007 missing an expected index", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "24",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      MISSING_RESOURCES_CODE_UNIQUE: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("17 index definitions");
  });

  it("rejects a recorded 0007 missing an expected foreign key", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      MISSING_RESOURCE_LEG_FK: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("38 constraints");
  });

  it("rejects a recorded 0007 with a foreign key targeting the wrong relation or action", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      EXPECTED_FOREIGN_KEY_DEFINITION_COUNT: "11",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("12 foreign-key definitions");
  });

  it("rejects a recorded 0007 missing an expected check", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      MISSING_BOOKING_TOTAL_CHECK: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("38 constraints");
  });

  it("rejects a recorded 0007 with a changed check definition", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      EXPECTED_CHECK_DEFINITION_COUNT: "17",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("18 check definitions");
  });

  it("rejects a recorded 0007 with a weakened check definition", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      WEAKENED_EXPECTED_CHECK: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("18 check definitions");
  });

  it("rejects a recorded 0007 missing an operational table column", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      MISSING_EXPECTED_TABLE_COLUMN: "1",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("56 column definitions");
  });

  it("rejects duplicate 0007 migration metadata", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "2",
    });

    expect(result.status).toBe(65);
    expect(result.stderr).toContain("exactly zero or one is valid");
  });

  it("allows a fully applied compatible 0007 database", async () => {
    const context = await fixture();

    const result = runPreflight({
      ...context.env,
      MIGRATION_RECORD_COUNT: "1",
      TARGET_RELATION_COUNT: "25",
      TARGET_TYPE_COUNT: "8",
      TARGET_TABLE_COUNT: "8",
      BOOKING_COLUMN_COUNT: "2",
      SIMULATE_CATALOG_TRUNCATION: "1",
      PACKAGE_TABLE_EXISTS: "t",
      RESOURCE_TABLE_EXISTS: "t",
    });

    expect(result.status, result.stderr).toBe(0);
  });
});
