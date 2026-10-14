import { randomUUID } from "node:crypto";
import {
  canonical,
  inputHash,
  transaction,
  type ConnectionDatabase,
  type SqlQuery,
} from "../chatgpt-connection/contracts";
import { findPairs, scorePair, type MatchProfile } from "./matching";

const q = (s: string) => '"' + s.replaceAll('"', '""') + '"';
const historical = new Set([
  "audit_entries",
  "chatgpt_operations",
  "chatgpt_update_proposals",
  "profile_merge_journal",
  "profile_duplicate_dismissals",
]);
const namedReferences = [
  "organization_id",
  "profile_id",
  "selected_organization_id",
  "imported_organization_id",
  "matched_organization_id",
  "saved_organization_id",
  "resolved_organization_id",
  "parent_organization_id",
  "linked_organization_id",
  "converted_organization_id",
  "applied_organization_id",
  "entity_id",
  "matched_entity_id",
  "applied_entity_id",
];
type Row = Record<string, any>;
type TableState = {
  table: string;
  columns: string[];
  keys: string[];
  json: boolean;
  rows: Row[];
};
type State = { profiles: Row[]; tables: TableState[] };
export class DuplicateError extends Error {
  constructor(
    message: string,
    public status = 409,
  ) {
    super(message);
  }
}
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const keyOf = (t: TableState, r: Row) => canonical(t.keys.map((k) => r[k]));

/** Catalog discovery covers new nullable profile FKs as well as legacy non-FK links. */
async function catalog(tx: SqlQuery): Promise<TableState[]> {
  const cols = (
    await tx.query(
      `SELECT c.table_name,c.column_name FROM information_schema.columns c
    JOIN information_schema.tables t USING(table_schema,table_name)
    WHERE c.table_schema=current_schema() AND t.table_type='BASE TABLE'
    AND c.data_type IN ('uuid','text','character varying')
    AND (c.column_name=ANY($1::text[]) OR EXISTS (
      SELECT 1 FROM pg_constraint f JOIN pg_attribute a ON a.attrelid=f.conrelid AND a.attnum=ANY(f.conkey)
      WHERE f.contype='f' AND f.confrelid='organizations'::regclass
      AND f.conrelid=(quote_ident(c.table_schema)||'.'||quote_ident(c.table_name))::regclass AND a.attname=c.column_name))
    ORDER BY c.table_name,c.column_name`,
      [namedReferences],
    )
  ).rows;
  const result = new Map<string, TableState>();
  for (const c of cols) {
    if (historical.has(c.table_name)) continue;
    // Historical source IDs identify provenance and must continue pointing at the archived original.
    if (
      ["consolidation_source_org_id", "consolidated_into_id"].includes(
        c.column_name,
      )
    )
      continue;
    if (!result.has(c.table_name))
      result.set(c.table_name, {
        table: c.table_name,
        columns: [],
        keys: [],
        json: false,
        rows: [],
      });
    result.get(c.table_name)!.columns.push(c.column_name);
  }
  for (const table of [
    "chatgpt_external_drafts",
    "assistant_workspace_drafts",
  ]) {
    if (
      (await tx.query("SELECT to_regclass($1) AS name", [table])).rows[0]?.name
    )
      result.set(table, { table, columns: [], keys: [], json: true, rows: [] });
  }
  const keys = (
    await tx.query(`SELECT t.relname AS table_name,a.attname AS column_name FROM pg_index i
    JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(i.indkey)
    WHERE i.indisprimary AND n.nspname=current_schema() ORDER BY t.relname,a.attnum`)
  ).rows;
  for (const k of keys) result.get(k.table_name)?.keys.push(k.column_name);
  return [...result.values()].sort((a, b) => a.table.localeCompare(b.table));
}
async function capture(
  tx: SqlQuery,
  ids: string[],
  lock: boolean,
): Promise<State> {
  const tables = await catalog(tx);
  if (lock) {
    await tx.query("SET LOCAL lock_timeout='5s'");
    await tx.query("SELECT pg_advisory_xact_lock(734802341)");
    for (const name of ["act_migration_records", "act_external_links"])
      if (tables.some((t) => t.table === name))
        await tx.query(`LOCK TABLE ${q(name)} IN EXCLUSIVE MODE`);
    await tx.query("LOCK TABLE organizations IN EXCLUSIVE MODE");
    if (tables.length)
      await tx.query(
        `LOCK TABLE ${tables.map((t) => q(t.table)).join(",")} IN SHARE ROW EXCLUSIVE MODE`,
      );
  }
  const profiles = (
    await tx.query(
      "SELECT * FROM organizations WHERE id=ANY($1::uuid[]) ORDER BY id",
      [ids],
    )
  ).rows;
  if (profiles.length !== 2)
    throw new DuplicateError("Both profiles must still exist.");
  for (const t of tables) {
    const where = t.json
      ? "content->>'organizationId'=ANY($1::text[])"
      : t.columns.map((c) => `${q(c)}::text=ANY($1::text[])`).join(" OR ");
    t.rows = (
      await tx.query(`SELECT * FROM ${q(t.table)} WHERE ${where}`, [ids])
    ).rows;
    if (t.rows.length && !t.keys.length)
      throw new DuplicateError(
        `Cannot safely journal ${t.table}: it has no primary key. No data was changed.`,
      );
    t.rows.sort((a, b) => keyOf(t, a).localeCompare(keyOf(t, b)));
  }
  // A contact can belong to several profiles while its legacy primary pointer
  // belongs to a third. Include those full contact fields in comparison/fingerprint.
  const memberships = tables.find((t) => t.table === "organization_contacts");
  const contactTable = tables.find((t) => t.table === "contacts");
  if (memberships && contactTable) {
    const contactIds = memberships.rows.map((r) => r.contact_id);
    const related = (
      await tx.query("SELECT * FROM contacts WHERE id=ANY($1::uuid[])", [
        contactIds,
      ])
    ).rows;
    contactTable.rows = [
      ...new Map(
        [...contactTable.rows, ...related].map((r) => [r.id, r]),
      ).values(),
    ].sort((a, b) =>
      keyOf(contactTable, a).localeCompare(keyOf(contactTable, b)),
    );
  }
  const state = plain({ profiles, tables });
  if (JSON.stringify(state).length > 8_000_000)
    throw new DuplicateError(
      "These profiles exceed the safe comparison limit. No data was changed.",
    );
  return state;
}
async function updateRow(tx: SqlQuery, t: TableState, row: Row, values: Row) {
  const fields = Object.keys(values);
  if (!fields.length) return;
  const params = fields.map((k) =>
    typeof values[k] === "object" && values[k] !== null
      ? JSON.stringify(values[k])
      : values[k],
  );
  params.push(...t.keys.map((k) => row[k]));
  await tx.query(
    `UPDATE ${q(t.table)} SET ${fields.map((k, i) => `${q(k)}=$${i + 1}`).join(",")} WHERE ${t.keys.map((k, i) => `${q(k)} IS NOT DISTINCT FROM $${fields.length + i + 1}`).join(" AND ")}`,
    params,
  );
}
const orgTable: TableState = {
  table: "organizations",
  keys: ["id"],
  columns: [],
  json: false,
  rows: [],
};
const priority = (t: TableState) =>
  t.table === "organization_locations"
    ? 0
    : t.table === "organization_contacts"
      ? 1
      : t.table === "contacts"
        ? 3
        : 2;
export class ProfileDuplicatesService {
  constructor(private db: ConnectionDatabase) {}
  async scan() {
    const profiles = (
      await this.db.query(
        "SELECT id,name,city,region FROM organizations WHERE consolidated_into_id IS NULL ORDER BY id",
      )
    ).rows as MatchProfile[];
    const dismissed = new Set(
      (
        await this.db.query(
          "SELECT left_id,right_id FROM profile_duplicate_dismissals",
        )
      ).rows.map((r) => `${r.left_id}:${r.right_id}`),
    );
    return { scanned: profiles.length, pairs: findPairs(profiles, dismissed) };
  }
  async check(input: MatchProfile) {
    const profiles = (
      await this.db.query(
        "SELECT id,name,city,region FROM organizations WHERE consolidated_into_id IS NULL",
      )
    ).rows;
    return profiles
      .map((p) => scorePair(input, p as MatchProfile))
      .filter((p) => p && p.confidence !== "Low")
      .sort((a, b) => b!.score - a!.score)
      .slice(0, 10);
  }
  async dismiss(ids: string[]) {
    const [left, right] = [...ids].sort();
    await this.db.query(
      "INSERT INTO profile_duplicate_dismissals(left_id,right_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [left, right],
    );
    return { dismissed: true };
  }
  async preview(ids: string[]) {
    return transaction(this.db, async (tx) => {
      const state = await capture(tx, ids, true);
      if (state.profiles.some((p) => p.consolidated_into_id))
        throw new DuplicateError(
          "A profile is already archived. Refresh the scan.",
        );
      return { ...state, fingerprint: inputHash(state) };
    });
  }
  async history() {
    return (
      await this.db.query(
        "SELECT id,survivor_id,source_id,created_at,undone_at,choices,conflicts FROM profile_merge_journal ORDER BY created_at DESC",
      )
    ).rows;
  }
  async merge(input: {
    survivorId: string;
    sourceId: string;
    fingerprint: string;
    choices: Record<string, string>;
    confirmed: boolean;
  }) {
    if (!input.confirmed)
      throw new DuplicateError("Confirm that these are the same profile.", 400);
    return transaction(this.db, async (tx) => {
      const ids = [input.survivorId, input.sourceId];
      const before = await capture(tx, ids, true);
      if (
        before.profiles.some((p) => p.consolidated_into_id) ||
        inputHash(before) !== input.fingerprint
      )
        throw new DuplicateError(
          "Profiles or linked records changed. Reopen the comparison before merging.",
        );
      const survivor = before.profiles.find((p) => p.id === input.survivorId)!;
      const source = before.profiles.find((p) => p.id === input.sourceId)!;
      if (
        before.tables.some(
          (t) =>
            t.table === "assistant_workspace_drafts" &&
            t.rows.some((r) => r.content?.organizationId === source.id),
        )
      )
        throw new DuplicateError(
          "This profile has an in-app assistant draft in a separate approval lifecycle. Resolve that draft before merging. Both profiles are unchanged.",
        );
      if (
        source.parent_organization_id === survivor.id ||
        survivor.parent_organization_id === source.id
      )
        throw new DuplicateError(
          "These profiles have a parent/location relationship. Resolve that relationship before merging.",
        );
      const conflicts: Row[] = [];
      for (const field of Object.keys(source))
        if (
          !["id", "created_at", "updated_at"].includes(field) &&
          !equal(source[field], survivor[field])
        )
          conflicts.push({
            field,
            survivorValue: survivor[field],
            sourceValue: source[field],
            chosenProfile: input.choices[field] ?? survivor.id,
          });
      const chosen: Row = {};
      for (const field of [
        "name",
        "city",
        "region",
        "phone",
        "website",
        "address_1",
        "address_2",
        "postal_code",
        "place_type",
      ])
        if (input.choices[field]) {
          if (!ids.includes(input.choices[field]))
            throw new DuplicateError("Invalid field choice.", 400);
          chosen[field] =
            input.choices[field] === source.id
              ? source[field]
              : survivor[field];
        }
      // Temporarily clear only the legacy primary-org pointer. Memberships must move
      // before it is restored because of the immediate composite contact FK.
      const contacts = before.tables.find((t) => t.table === "contacts");
      for (const row of contacts?.rows ?? [])
        if (row.organization_id === source.id)
          await updateRow(tx, contacts!, row, { organization_id: null });
      for (const t of [...before.tables].sort(
        (a, b) => priority(a) - priority(b),
      )) {
        for (const row of t.rows) {
          const values: Row = {};
          for (const col of t.columns)
            if (row[col] === source.id) values[col] = survivor.id;
          if (t.json && row.content?.organizationId === source.id) {
            values.content = { ...row.content, organizationId: survivor.id };
            if ("revision" in row) values.revision = randomUUID();
          }
          if (!Object.keys(values).length) continue;
          if (t.table === "organization_contacts") {
            const existing = t.rows.find(
              (r) =>
                r.organization_id === survivor.id &&
                r.contact_id === row.contact_id,
            );
            if (existing) {
              // Preserve both membership rows and their roles, retain the archived
              // source copy as evidence; the live survivor already has this contact.
              conflicts.push({
                table: t.table,
                key: keyOf(t, row),
                message:
                  "Shared contact: both membership roles retained; source membership archived.",
                values: row,
              });
              if (row.active && !existing.active)
                await updateRow(tx, t, existing, { active: true });
              await updateRow(tx, t, row, { active: false, is_primary: false });
              continue;
            }
            values.is_primary = false;
          }
          if (t.table === "act_external_links" && "is_primary" in row)
            values.is_primary = false;
          try {
            await updateRow(tx, t, row, values);
          } catch (e: any) {
            if (["23505", "23503", "23514"].includes(e.code))
              throw new DuplicateError(
                `Conflicting linked records in ${t.table}. Both profiles are unchanged. Resolve that conflict before merging.`,
              );
            throw e;
          }
        }
      }
      // Contact choice controls the primary designation; all contacts are retained.
      const memberships = before.tables.find(
        (t) => t.table === "organization_contacts",
      );
      if (memberships && input.choices.contacts) {
        if (!ids.includes(input.choices.contacts))
          throw new DuplicateError("Invalid contact choice.", 400);
        const primary = memberships.rows.find(
          (r) =>
            r.organization_id === input.choices.contacts &&
            r.is_primary &&
            r.active,
        );
        if (primary) {
          await tx.query(
            "UPDATE organization_contacts SET is_primary=false WHERE organization_id=$1 AND is_primary",
            [survivor.id],
          );
          await tx.query(
            "UPDATE organization_contacts SET is_primary=true WHERE organization_id=$1 AND contact_id=$2 AND active",
            [survivor.id, primary.contact_id],
          );
        }
      }
      await updateRow(tx, orgTable, survivor, {
        ...chosen,
        updated_at: new Date().toISOString(),
      });
      await updateRow(tx, orgTable, source, {
        consolidated_into_id: survivor.id,
        consolidated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      const after = await capture(tx, ids, false);
      const id = randomUUID();
      await tx.query(
        "INSERT INTO profile_merge_journal(id,survivor_id,source_id,before_state,after_state,choices,conflicts) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          survivor.id,
          source.id,
          JSON.stringify(before),
          JSON.stringify(after),
          JSON.stringify(input.choices),
          JSON.stringify(conflicts),
        ],
      );
      return { id, survivorId: survivor.id, conflicts };
    });
  }
  async undo(id: string) {
    return transaction(this.db, async (tx) => {
      // Same lock domain/order as merge; journal lock comes after CRM table locks.
      const first = (
        await tx.query("SELECT * FROM profile_merge_journal WHERE id=$1", [id])
      ).rows[0];
      if (!first) throw new DuplicateError("Merge not found.", 404);
      const current = await capture(
        tx,
        [first.survivor_id, first.source_id],
        true,
      );
      const record = (
        await tx.query(
          "SELECT * FROM profile_merge_journal WHERE id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      if (record.undone_at) return { undone: true };
      const before: State = record.before_state,
        after: State = record.after_state;
      const restores: { table: TableState; row: Row; values: Row }[] = [];
      const collect = (
        t: TableState,
        originals: Row[],
        later: Row[],
        live: Row[],
      ) => {
        for (const row of originals) {
          let next = later.find((r) => keyOf(t, r) === keyOf(t, row));
          if (!next && t.columns.some((c) => t.keys.includes(c)))
            next = later.find((r) =>
              t.keys.every(
                (k) =>
                  r[k] ===
                  (row[k] === record.source_id ? record.survivor_id : row[k]),
              ),
            );
          if (!next)
            throw new DuplicateError(
              `Cannot locate original ${t.table} data. Nothing was changed.`,
            );
          const changed = Object.keys(row).filter(
            (k) => !equal(row[k], next![k]),
          );
          if (!changed.length) continue;
          const now = live.find((r) => keyOf(t, r) === keyOf(t, next!));
          if (!now)
            throw new DuplicateError(
              `${t.table} changed after this merge: a moved record is missing. Nothing was changed.`,
            );
          const values: Row = {};
          for (const field of changed) {
            // Preserve timestamps from later unrelated edits as well as those edits.
            if (field === "updated_at" && !equal(now[field], next[field]))
              continue;
            if (!equal(now[field], next[field]))
              throw new DuplicateError(
                `${t.table}.${field} changed after this merge. Undo is retained; resolve this conflicting edit before retrying.`,
              );
            values[field] = row[field];
          }
          restores.push({ table: t, row: now, values });
        }
      };
      for (const t of before.tables)
        collect(
          t,
          t.rows,
          after.tables.find((a) => a.table === t.table)?.rows ?? [],
          current.tables.find((a) => a.table === t.table)?.rows ?? [],
        );
      collect(orgTable, before.profiles, after.profiles, current.profiles);
      const movingLocations = new Set(
        restores
          .filter(
            (r) =>
              r.table.table === "organization_locations" &&
              "organization_id" in r.values,
          )
          .map((r) => r.row.id),
      );
      for (const t of current.tables)
        for (const row of t.rows) {
          if (
            movingLocations.has(row.organization_location_id) &&
            row.organization_id === record.survivor_id &&
            !restores.some(
              (r) =>
                r.table.table === t.table &&
                keyOf(t, r.row) === keyOf(t, row) &&
                r.values.organization_id === record.source_id,
            )
          ) {
            throw new DuplicateError(
              `A newer ${t.table} record uses a moved location. Resolve its profile/location assignment before undoing; nothing was changed.`,
            );
          }
        }
      for (const restore of restores) {
        if (
          restore.table.table === "contacts" &&
          "organization_id" in restore.values
        )
          await updateRow(tx, restore.table, restore.row, {
            organization_id: null,
          });
        if (
          restore.table.table === "organization_contacts" &&
          "is_primary" in restore.values
        )
          await updateRow(tx, restore.table, restore.row, {
            is_primary: false,
          });
      }
      for (const restore of restores.sort(
        (a, b) => priority(a.table) - priority(b.table),
      ))
        await updateRow(tx, restore.table, restore.row, restore.values);
      await tx.query(
        "UPDATE profile_merge_journal SET undone_at=now() WHERE id=$1",
        [id],
      );
      return { undone: true };
    });
  }
}
