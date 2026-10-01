import {
  ConnectionError,
  inputHash,
  type SqlQuery,
} from "../chatgpt-connection/contracts";
import {
  createWorkSchema,
  filterSchema,
  patchWorkSchema,
  type CreateWork,
  type PatchWork,
  type WorkActor,
  type WorkActivity,
  type WorkFilter,
  type WorkPage,
} from "./contracts";
const iso = (v: any) => (v == null ? null : new Date(v).toISOString());
function view(r: any): WorkActivity {
  return {
    id: r.id,
    profileId: r.profile_id,
    eventYear: r.event_year,
    bookingId: r.booking_id,
    queue: r.queue,
    title: r.title,
    nextAction: r.next_action,
    assignedTo: r.assigned_to,
    status: r.status,
    dueAt: iso(r.due_at),
    progress: r.progress,
    links: r.links,
    revision: r.revision,
    createdAt: iso(r.created_at)!,
    updatedAt: iso(r.updated_at)!,
  };
}
export class WorkConflict extends ConnectionError {
  constructor(public current: WorkActivity | null) {
    super("WORK_REVISION_CONFLICT", 409);
  }
}
export class BookingWorkRepository {
  constructor(private tx: SqlQuery) {}
  async createOrGet(raw: CreateWork, actor: WorkActor) {
    const i = createWorkSchema.parse(raw);
    const r = await this.tx.query(
      `INSERT INTO booking_work_activities(profile_id,event_year,booking_id,queue,title,next_action,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT(profile_id,event_year) WHERE status NOT IN ('completed','cancelled') DO NOTHING RETURNING *`,
      [
        i.profileId,
        i.eventYear,
        i.bookingId ?? null,
        i.queue,
        i.title,
        i.nextAction,
        JSON.stringify(actor),
      ],
    );
    if (r.rows[0]) return { activity: view(r.rows[0]), created: true };
    const existing = await this.tx.query(
      `SELECT * FROM booking_work_activities WHERE profile_id=$1 AND event_year=$2 AND status NOT IN ('completed','cancelled')`,
      [i.profileId, i.eventYear],
    );
    if (!existing.rows[0]) throw new ConnectionError("WORK_RETRY_CLAIM", 409);
    return { activity: view(existing.rows[0]), created: false };
  }
  async read(id: string) {
    const r = await this.tx.query(
      "SELECT * FROM booking_work_activities WHERE id=$1",
      [id],
    );
    return r.rows[0] ? view(r.rows[0]) : null;
  }
  async list(raw: WorkFilter): Promise<WorkPage> {
    const { cursor, limit = 20, ...f } = filterSchema.parse(raw);
    const hash = inputHash(f);
    const params: any[] = [];
    const where: string[] = [];
    for (const [key, col] of [
      ["profileId", "profile_id"],
      ["eventYear", "event_year"],
      ["status", "status"],
      ["queue", "queue"],
    ] as const)
      if (f[key] !== undefined) {
        params.push(f[key]);
        where.push(`${col}=$${params.length}`);
      }
    if (f.actor) {
      params.push(JSON.stringify(f.actor));
      where.push(`assigned_to=$${params.length}::jsonb`);
    }
    if (cursor) {
      let c: any;
      try {
        c = JSON.parse(Buffer.from(cursor, "base64url").toString());
        if (
          c.hash !== hash ||
          typeof c.id !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(c.id) ||
          !Number.isFinite(Date.parse(c.at))
        )
          throw Error();
      } catch {
        throw new ConnectionError("WORK_INVALID_CURSOR");
      }
      params.push(c.at, c.id);
      where.push(
        `(created_at,id)>($${params.length - 1}::timestamptz,$${params.length}::uuid)`,
      );
    }
    params.push(limit + 1);
    const r = await this.tx.query(
      `SELECT * FROM booking_work_activities ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at,id LIMIT $${params.length}`,
      params,
    );
    const items = r.rows.slice(0, limit).map(view);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        r.rows.length > limit && last
          ? Buffer.from(
              JSON.stringify({ hash, at: last.createdAt, id: last.id }),
            ).toString("base64url")
          : null,
    };
  }
  async patch(
    id: string,
    revision: number,
    raw: PatchWork,
    actor: WorkActor | null,
  ) {
    const p: PatchWork = Object.keys(raw).length
      ? patchWorkSchema.parse(raw)
      : {};
    const params: any[] = [id, revision, JSON.stringify(actor)];
    const set = [
      "assigned_to=$3::jsonb",
      "revision=revision+1",
      "updated_at=clock_timestamp()",
    ];
    for (const [key, col, json] of [
      ["status", "status", false],
      ["nextAction", "next_action", false],
      ["dueAt", "due_at", false],
      ["progress", "progress", true],
      ["links", "links", true],
    ] as const)
      if (p[key] !== undefined) {
        params.push(json ? JSON.stringify(p[key]) : p[key]);
        set.push(`${col}=$${params.length}${json ? "::jsonb" : ""}`);
      }
    const r = await this.tx.query(
      `UPDATE booking_work_activities SET ${set.join(",")} WHERE id=$1 AND revision=$2 RETURNING *`,
      params,
    );
    if (!r.rows[0]) throw new WorkConflict(await this.read(id));
    return view(r.rows[0]);
  }
}
