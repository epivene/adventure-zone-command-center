import { sql } from "drizzle-orm";
import { z } from "zod";

import type { db as database } from "@/db/client";

export const CALL_SCRIPT_KINDS = [
  "first_outreach",
  "rebooking",
  "follow_up",
  "proposal_contract",
  "callback",
  "incoming_inquiry",
] as const;

export const CALL_SCRIPT_NODE_IDS = [
  "opening",
  "details",
  "package_interest",
  "pricing",
  "next_step",
  "callback_time",
  "decision_maker",
  "close_declined",
] as const;

export const CALL_SCRIPT_PLACEHOLDERS = [
  "contactName",
  "eventName",
  "eventDate",
  "location",
  "packageInterest",
] as const;

export type CallScriptKind = (typeof CALL_SCRIPT_KINDS)[number];
export type CallScriptNodeId = (typeof CALL_SCRIPT_NODE_IDS)[number];

export type CallScriptOverrideRecord = {
  scriptKind: CallScriptKind;
  nodeId: CallScriptNodeId;
  sayText: string;
  coachText: string | null;
  updatedAt: string;
};

const placeholderSet = new Set<string>(CALL_SCRIPT_PLACEHOLDERS);

export function validateCallScriptPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(/\{\{([A-Za-z0-9_]+)\}\}/g)) {
    const name = match[1];
    if (name && !placeholderSet.has(name)) unknown.add(name);
  }
  return [...unknown];
}

function validatePlaceholders(value: string, ctx: z.RefinementCtx) {
  const unknown = validateCallScriptPlaceholders(value);
  if (unknown.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Unknown script placeholder${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
    });
  }
}

export const callScriptOverrideInputSchema = z.object({
  scriptKind: z.enum(CALL_SCRIPT_KINDS),
  nodeId: z.enum(CALL_SCRIPT_NODE_IDS),
  sayText: z.string().trim().min(1, "Say this cannot be empty.").max(2_000).superRefine(validatePlaceholders),
  coachText: z.string().trim().max(2_000).nullable().optional(),
});

export type CallScriptOverrideInput = z.infer<typeof callScriptOverrideInputSchema>;

type DrizzleDatabase = typeof database;

type OverrideRow = {
  script_kind: CallScriptKind;
  node_id: CallScriptNodeId;
  say_text: string;
  coach_text: string | null;
  updated_at: Date | string;
};

const schemaPromises = new WeakMap<object, Promise<void>>();

function rowsOf<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return ((result as { rows?: T[] }).rows ?? []);
  }
  return Array.isArray(result) ? (result as T[]) : [];
}

function mapRow(row: OverrideRow): CallScriptOverrideRecord {
  return {
    scriptKind: row.script_kind,
    nodeId: row.node_id,
    sayText: row.say_text,
    coachText: row.coach_text,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}

export async function ensureCallScriptSettingsSchema(database: DrizzleDatabase): Promise<void> {
  const key = database as unknown as object;
  const existing = schemaPromises.get(key);
  if (existing) return existing;

  const pending = database.execute(sql.raw(`
    create table if not exists call_script_overrides (
      script_kind text not null,
      node_id text not null,
      say_text text not null,
      coach_text text,
      updated_by text,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      primary key (script_kind, node_id),
      constraint call_script_overrides_script_kind_valid check (
        script_kind in ('first_outreach','rebooking','follow_up','proposal_contract','callback','incoming_inquiry')
      ),
      constraint call_script_overrides_node_id_valid check (
        node_id in ('opening','details','package_interest','pricing','next_step','callback_time','decision_maker','close_declined')
      )
    );
  `)).then(() => undefined).catch((error) => {
    schemaPromises.delete(key);
    throw error;
  });

  schemaPromises.set(key, pending);
  return pending;
}

export class DrizzleCallScriptSettingsRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async ensureSchema(): Promise<void> {
    await ensureCallScriptSettingsSchema(this.database);
  }

  async listOverrides(): Promise<CallScriptOverrideRecord[]> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      select script_kind, node_id, say_text, coach_text, updated_at
      from call_script_overrides
      order by script_kind, node_id
    `);
    return rowsOf<OverrideRow>(result).map(mapRow);
  }

  async upsertOverride(input: CallScriptOverrideInput, actorId: string): Promise<CallScriptOverrideRecord> {
    const parsed = callScriptOverrideInputSchema.parse(input);
    const coachText = parsed.coachText?.trim() || null;
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into call_script_overrides (
        script_kind, node_id, say_text, coach_text, updated_by, created_at, updated_at
      ) values (
        ${parsed.scriptKind}, ${parsed.nodeId}, ${parsed.sayText.trim()}, ${coachText}, ${actorId}, now(), now()
      )
      on conflict (script_kind, node_id) do update set
        say_text = excluded.say_text,
        coach_text = excluded.coach_text,
        updated_by = excluded.updated_by,
        updated_at = now()
      returning script_kind, node_id, say_text, coach_text, updated_at
    `);
    const row = rowsOf<OverrideRow>(result)[0];
    if (!row) throw new Error("Call script override was not returned after save.");
    return mapRow(row);
  }

  async deleteOverride(scriptKind: CallScriptKind, nodeId: CallScriptNodeId): Promise<void> {
    const parsed = callScriptOverrideInputSchema.pick({ scriptKind: true, nodeId: true }).parse({ scriptKind, nodeId });
    await this.ensureSchema();
    await this.database.execute(sql`
      delete from call_script_overrides
      where script_kind = ${parsed.scriptKind}
        and node_id = ${parsed.nodeId}
    `);
  }
}
