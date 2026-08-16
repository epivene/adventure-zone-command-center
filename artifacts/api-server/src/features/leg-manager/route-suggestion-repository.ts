import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";

export type ManagerRouteSuggestionStatus = "pending" | "approved" | "rejected";
export type ManagerRouteSuggestionTarget = "trip" | "trip_stop" | "booking" | "handoff";

export type ManagerRouteSuggestion = {
  id: string;
  legId: string;
  submittedByManagerId: string | null;
  targetType: ManagerRouteSuggestionTarget;
  targetId: string;
  kind: string;
  beforeJson: Record<string, unknown> | null;
  proposedJson: Record<string, unknown>;
  reason: string;
  status: ManagerRouteSuggestionStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  adminResponse: string | null;
  stale: boolean;
  createdAt: Date;
};

export type CreateManagerRouteSuggestionInput = Omit<ManagerRouteSuggestion, "id" | "status" | "reviewedBy" | "reviewedAt" | "adminResponse" | "stale" | "createdAt">;

export interface ManagerRouteSuggestionStore {
  create(input: CreateManagerRouteSuggestionInput): Promise<ManagerRouteSuggestion>;
  get(id: string): Promise<ManagerRouteSuggestion | null>;
  listForLeg(legId: string): Promise<ManagerRouteSuggestion[]>;
  listPending(): Promise<ManagerRouteSuggestion[]>;
  markApproved(id: string, reviewedBy: string | null): Promise<ManagerRouteSuggestion | null>;
  markRejected(id: string, reviewedBy: string | null, adminResponse: string | null): Promise<ManagerRouteSuggestion | null>;
  markStale(id: string): Promise<ManagerRouteSuggestion | null>;
}

type DrizzleDatabase = typeof database;
function rows<T>(value: unknown): T[] { return ((value as { rows?: T[] }).rows ?? []) as T[]; }
function normalize(row: any): ManagerRouteSuggestion {
  return {
    ...row,
    beforeJson: row.beforeJson ?? null,
    proposedJson: row.proposedJson ?? {},
    stale: Boolean(row.stale),
    reviewedAt: row.reviewedAt ? new Date(row.reviewedAt) : null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt),
  };
}

const ensureSql = sql.raw(`
create table if not exists manager_route_suggestions (
  id uuid primary key default gen_random_uuid(),
  leg_id uuid not null references travel_legs(id) on delete restrict,
  submitted_by_manager_id uuid,
  target_type text not null check (target_type in ('trip','trip_stop','booking','handoff')),
  target_id uuid not null,
  kind text not null,
  before_json jsonb,
  proposed_json jsonb not null,
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by text,
  reviewed_at timestamptz,
  admin_response text,
  stale boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists manager_route_suggestions_leg_created_idx on manager_route_suggestions(leg_id, created_at desc);
create index if not exists manager_route_suggestions_status_created_idx on manager_route_suggestions(status, created_at);
`);

const selection = sql.raw(`
  id,
  leg_id as "legId",
  submitted_by_manager_id as "submittedByManagerId",
  target_type as "targetType",
  target_id as "targetId",
  kind,
  before_json as "beforeJson",
  proposed_json as "proposedJson",
  reason,
  status,
  reviewed_by as "reviewedBy",
  reviewed_at as "reviewedAt",
  admin_response as "adminResponse",
  stale,
  created_at as "createdAt"
`);

export class DrizzleManagerRouteSuggestionRepository implements ManagerRouteSuggestionStore {
  constructor(private readonly database: DrizzleDatabase) {}
  async ensureSchema() { await this.database.execute(ensureSql); }

  async create(input: CreateManagerRouteSuggestionInput): Promise<ManagerRouteSuggestion> {
    await this.ensureSchema();
    const result = await this.database.execute(sql`
      insert into manager_route_suggestions (
        leg_id, submitted_by_manager_id, target_type, target_id, kind, before_json, proposed_json, reason
      ) values (
        ${input.legId}::uuid, ${input.submittedByManagerId}::uuid, ${input.targetType}, ${input.targetId}::uuid,
        ${input.kind}, ${JSON.stringify(input.beforeJson)}::jsonb, ${JSON.stringify(input.proposedJson)}::jsonb, ${input.reason.trim()}
      )
      returning ${selection}
    `);
    const row = rows<any>(result)[0];
    if (!row) throw new Error("Route suggestion could not be saved.");
    return normalize(row);
  }

  async get(id: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`select ${selection} from manager_route_suggestions where id=${id}::uuid limit 1`);
    const row = rows<any>(result)[0];
    return row ? normalize(row) : null;
  }

  async listForLeg(legId: string) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`select ${selection} from manager_route_suggestions where leg_id=${legId}::uuid order by created_at desc`);
    return rows<any>(result).map(normalize);
  }

  async listPending() {
    await this.ensureSchema();
    const result = await this.database.execute(sql`select ${selection} from manager_route_suggestions where status='pending' order by created_at asc`);
    return rows<any>(result).map(normalize);
  }

  private async review(id: string, setSql: ReturnType<typeof sql.raw>) {
    await this.ensureSchema();
    const result = await this.database.execute(sql`update manager_route_suggestions set ${setSql} where id=${id}::uuid and status='pending' returning ${selection}`);
    const row = rows<any>(result)[0];
    return row ? normalize(row) : null;
  }

  markApproved(id: string, reviewedBy: string | null) {
    const reviewer = reviewedBy?.replaceAll("'", "''") ?? null;
    return this.review(id, sql.raw(`status='approved', reviewed_by=${reviewer ? `'${reviewer}'` : "null"}, reviewed_at=now(), stale=false`));
  }
  markRejected(id: string, reviewedBy: string | null, adminResponse: string | null) {
    const reviewer = reviewedBy?.replaceAll("'", "''") ?? null;
    const response = adminResponse?.replaceAll("'", "''") ?? null;
    return this.review(id, sql.raw(`status='rejected', reviewed_by=${reviewer ? `'${reviewer}'` : "null"}, reviewed_at=now(), admin_response=${response ? `'${response}'` : "null"}`));
  }
  markStale(id: string) { return this.review(id, sql.raw("stale=true")); }
}
