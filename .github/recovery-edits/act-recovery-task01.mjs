import { readFileSync, writeFileSync } from "node:fs";

function edit(path, update) {
  const before = readFileSync(path, "utf8");
  const after = update(before);
  if (after === before) {
    console.log(`No change: ${path}`);
    return;
  }
  writeFileSync(path, after);
  console.log(`Updated: ${path}`);
}

edit("lib/db/src/migrations.ts", (source) => {
  if (source.includes('name: "043_act_archive_full_recovery.sql"')) return source;
  const needle = `  {
    name: "042_manual_organization_membership.sql",
    markerSql: \`SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'organizations'
        AND column_name = 'parent_organization_id'
    ) AS ready\`,
  },
`;
  if (!source.includes(needle)) throw new Error("Task 1 migration insertion point changed");
  return source.replace(needle, `${needle}  {
    name: "043_act_archive_full_recovery.sql",
    markerSql: \`SELECT
      to_regclass(current_schema() || '.act_archive_recovery_runs') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_recovery_items') IS NOT NULL
      AND to_regclass(current_schema() || '.act_archive_recovery_decisions') IS NOT NULL
      AS ready\`,
  },
`);
});

edit("lib/db/src/schema/index.ts", (source) => {
  if (source.includes("export const actArchiveRecoveryRuns")) return source;
  const needle = `\n\n\nexport const actReplacementCheckpoints = pgTable(`;
  if (!source.includes(needle)) throw new Error("Task 1 schema insertion point changed");
  const definitions = `

export const actArchiveRecoveryRuns = pgTable(
  "act_archive_recovery_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceDatabaseKey: text("source_database_key").notNull(),
    requestedBy: text("requested_by").notNull(),
    requestKey: text("request_key").notNull(),
    state: text("state").default("running").notNull(),
    candidateCount: integer("candidate_count").default(0).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("act_archive_recovery_runs_database_request_unique").on(table.sourceDatabaseKey, table.requestKey),
    check("act_archive_recovery_runs_state_valid", sql\`\${table.state} in ('running','complete','failed')\`),
    check("act_archive_recovery_runs_database_nonblank", sql\`btrim(\${table.sourceDatabaseKey}) <> ''\`),
    check("act_archive_recovery_runs_actor_nonblank", sql\`btrim(\${table.requestedBy}) <> '' and btrim(\${table.requestKey}) <> ''\`),
    check("act_archive_recovery_runs_candidate_count_nonnegative", sql\`\${table.candidateCount} >= 0\`),
  ],
);

export const actArchiveRecoveryItems = pgTable(
  "act_archive_recovery_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull().references(() => actArchiveRecoveryRuns.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id, { onDelete: "cascade" }),
    sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id),
    streamType: text("stream_type").notNull(),
    priority: integer("priority").notNull(),
    state: text("state").default("pending").notNull(),
    targetSummary: jsonb("target_summary").$type<Record<string, unknown>>().default(sql\`'{}'::jsonb\`).notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    lastErrorCode: text("last_error_code"),
    retryAfter: timestamp("retry_after", { withTimezone: true }),
    leaseOwner: text("lease_owner"),
    leaseToken: uuid("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("act_archive_recovery_items_run_source_unique").on(table.runId, table.sourceRecordId),
    foreignKey({
      columns: [table.sourceVersionId, table.sourceRecordId],
      foreignColumns: [actSourceRecordVersions.id, actSourceRecordVersions.sourceRecordId],
      name: "act_archive_recovery_items_version_owner_fk",
    }),
    index("act_archive_recovery_items_claim_idx").on(table.state, table.retryAfter, table.priority, table.sourceRecordId),
    check("act_archive_recovery_items_state_valid", sql\`\${table.state} in ('pending','leased','already_present','recovered','needs_review','dropped_unusable','retryable_failed')\`),
    check("act_archive_recovery_items_target_summary_object", sql\`jsonb_typeof(\${table.targetSummary}) = 'object'\`),
    check("act_archive_recovery_items_attempt_count_nonnegative", sql\`\${table.attemptCount} >= 0\`),
    check("act_archive_recovery_items_lease_consistency", sql\`(\${table.leaseToken} is null and \${table.leaseOwner} is null and \${table.leaseExpiresAt} is null) or (\${table.leaseToken} is not null and \${table.leaseOwner} is not null and \${table.leaseExpiresAt} is not null)\`),
  ],
);

export const actArchiveRecoveryDecisions = pgTable(
  "act_archive_recovery_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id").notNull().references(() => actArchiveRecoveryRuns.id, { onDelete: "cascade" }),
    sourceRecordId: uuid("source_record_id").notNull().references(() => actSourceRecords.id),
    sourceVersionId: uuid("source_version_id").notNull().references(() => actSourceRecordVersions.id),
    decision: text("decision").notNull(),
    targetEntityType: text("target_entity_type"),
    targetEntityId: uuid("target_entity_id"),
    decidedBy: text("decided_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.sourceVersionId, table.sourceRecordId],
      foreignColumns: [actSourceRecordVersions.id, actSourceRecordVersions.sourceRecordId],
      name: "act_archive_recovery_decisions_version_owner_fk",
    }),
    index("act_archive_recovery_decisions_source_idx").on(table.runId, table.sourceRecordId, table.createdAt),
    check("act_archive_recovery_decisions_decision_valid", sql\`\${table.decision} in ('assign_parent','drop_unusable','retry')\`),
    check("act_archive_recovery_decisions_target_type_valid", sql\`\${table.targetEntityType} is null or \${table.targetEntityType} in ('organization','contact','booking','calling_list','activity')\`),
    check("act_archive_recovery_decisions_target_pair_valid", sql\`(\${table.targetEntityType} is null) = (\${table.targetEntityId} is null)\`),
    check("act_archive_recovery_decisions_actor_nonblank", sql\`btrim(\${table.decidedBy}) <> ''\`),
  ],
);
`;
  return source.replace(needle, `${definitions}\n\nexport const actReplacementCheckpoints = pgTable(`);
});
