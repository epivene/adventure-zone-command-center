import { createHash, randomUUID } from "node:crypto";
import {
  ConventionError,
  matchProfile,
  nextYearMember,
  validateMember,
  type Member,
  type ProfileCandidate,
} from "./policy";

export interface QueryClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
  release?(): void;
}
export interface QueryPool extends QueryClient {
  connect(): Promise<QueryClient>;
}
export class ConventionRepository {
  pool: QueryPool;
  constructor(pool: QueryPool) {
    this.pool = pool;
  }
  async transaction<T>(fn: (client: QueryClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release?.();
    }
  }
  async edition(client: QueryClient, id: string, revision?: number) {
    const row = (
      await client.query(
        "SELECT * FROM convention_editions WHERE id=$1 FOR UPDATE",
        [id],
      )
    ).rows[0];
    if (!row) throw new ConventionError("Convention not found.", 404);
    if (revision !== undefined && row.revision !== revision)
      throw new ConventionError(
        "This list changed. Reload before saving.",
        409,
      );
    return row;
  }
  async audit(
    client: QueryClient,
    editionId: string,
    memberId: string | null,
    kind: string,
    actor: string,
    key: string,
    payload: unknown,
  ) {
    await client.query(
      "INSERT INTO convention_history(edition_id,member_id,kind,actor,mutation_key,payload) VALUES($1,$2,$3,$4,$5,$6)",
      [editionId, memberId, kind, actor, key, JSON.stringify(payload)],
    );
  }
  async list() {
    return (
      await this.pool.query(`SELECT e.*, count(m.id)::int AS member_count,
      count(m.id) FILTER (WHERE m.organization_id IS NULL)::int AS unresolved_count
      FROM convention_editions e LEFT JOIN convention_members m ON m.edition_id=e.id
      GROUP BY e.id ORDER BY e.year DESC,e.convention`)
    ).rows;
  }
  async searchProfiles(query: string) {
    return (
      await this.pool.query(
        `SELECT o.id AS "organizationId",o.name, c.id AS "contactId",c.email,
      concat_ws(' ',c.first_name,c.last_name) AS contact
      FROM organizations o LEFT JOIN contacts c ON c.organization_id=o.id OR EXISTS
        (SELECT 1 FROM organization_contacts oc WHERE oc.organization_id=o.id AND oc.contact_id=c.id AND oc.active=true)
      WHERE position(lower($1) in lower(o.name))>0 OR position(lower($1) in lower(coalesce(c.email,'')))>0
      ORDER BY o.name,c.id LIMIT 30`,
        [query],
      )
    ).rows;
  }
  async detail(id: string, actor: string) {
    const edition = (
      await this.pool.query("SELECT * FROM convention_editions WHERE id=$1", [
        id,
      ])
    ).rows[0];
    if (!edition) throw new ConventionError("Convention not found.", 404);
    const [members, history, reviews] = await Promise.all([
      this.pool.query(
        `SELECT m.*,
          coalesce(nullif(b.city,''),o.city) AS event_city,
          coalesce(nullif(b.region,''),o.region) AS event_region,
          o.place_type AS event_place_type,
          b.name AS event_booking_name,
          b.starts_at AS event_starts_at,
          b.ends_at AS event_ends_at
        FROM convention_members m
        LEFT JOIN organizations o ON o.id=m.organization_id
        LEFT JOIN LATERAL (
          SELECT name,city,region,starts_at,ends_at
          FROM bookings
          WHERE organization_id=m.organization_id
          ORDER BY
            CASE WHEN starts_at IS NULL THEN 1 ELSE 0 END,
            abs(extract(year FROM starts_at)::int-$2),
            starts_at DESC
          LIMIT 1
        ) b ON true
        WHERE m.edition_id=$1
        ORDER BY m.data->>'event',m.id`,
        [id, edition.year],
      ),
      this.pool.query(
        "SELECT * FROM convention_history WHERE edition_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 200",
        [id],
      ),
      this.pool.query(
        "SELECT * FROM convention_reviews WHERE edition_id=$1 AND actor=$2",
        [id, actor],
      ),
    ]);
    return {
      edition,
      members: members.rows.map((member) => {
        const {
          event_city,
          event_region,
          event_place_type,
          event_booking_name,
          event_starts_at,
          event_ends_at,
          ...stored
        } = member;
        return {
          ...stored,
          event_info: member.organization_id
            ? {
                city: event_city,
                region: event_region,
                placeType: event_place_type,
                bookingName: event_booking_name,
                startsAt: event_starts_at,
                endsAt: event_ends_at,
              }
            : null,
        };
      }),
      history: history.rows,
      review: reviews.rows[0] ?? null,
    };
  }
  async create(
    input: {
      convention: string;
      year: number;
      summary: string;
      recommendation: string;
      sources: string;
    },
    actor: string,
  ) {
    return this.transaction(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO convention_editions(convention,year,summary,recommendation,sources)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(convention,year) DO NOTHING RETURNING *`,
          [
            input.convention,
            input.year,
            input.summary,
            input.recommendation,
            input.sources,
          ],
        )
      ).rows[0];
      if (!row)
        throw new ConventionError(
          "That convention and year already exist.",
          409,
        );
      await this.audit(c, row.id, null, "created", actor, randomUUID(), input);
      return row;
    });
  }
  async candidates(
    client: QueryClient,
    members: Member[],
  ): Promise<ProfileCandidate[]> {
    const emails = [
      ...new Set(
        members.map((m) => m.email.trim().toLowerCase()).filter(Boolean),
      ),
    ];
    if (!emails.length) return [];
    return (
      await client.query(
        `SELECT DISTINCT o.id AS "organizationId", c.id AS "contactId", c.email, o.name
      FROM contacts c JOIN organizations o ON o.id=c.organization_id OR EXISTS
        (SELECT 1 FROM organization_contacts oc WHERE oc.organization_id=o.id AND oc.contact_id=c.id AND oc.active=true)
      WHERE lower(trim(c.email)) = ANY($1::text[])`,
        [emails],
      )
    ).rows;
  }
  async preview(id: string, raw: unknown[]) {
    const members = raw.map(validateMember);
    if (new Set(members.map((m) => m.sourceKey)).size !== members.length)
      throw new ConventionError("Duplicate source keys in the import.");
    const edition = (
      await this.pool.query(
        "SELECT revision,archived_at FROM convention_editions WHERE id=$1",
        [id],
      )
    ).rows[0];
    if (!edition) throw new ConventionError("Convention not found.", 404);
    if (edition.archived_at)
      throw new ConventionError("This year is archived.", 409);
    const candidates = await this.candidates(this.pool, members);
    return {
      revision: edition.revision,
      rows: members.map((member) => ({
        member,
        match: matchProfile(member, candidates),
      })),
    };
  }
  async import(
    id: string,
    raw: unknown[],
    revision: number,
    mutationKey: string,
    actor: string,
  ) {
    const members = raw.map(validateMember);
    if (new Set(members.map((m) => m.sourceKey)).size !== members.length)
      throw new ConventionError("Duplicate source keys in the import.");
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(members))
      .digest("hex");
    return this.transaction(async (c) => {
      const edition = await this.edition(c, id);
      const prior = (
        await c.query(
          "SELECT payload FROM convention_history WHERE edition_id=$1 AND mutation_key=$2",
          [id, mutationKey],
        )
      ).rows[0];
      if (prior) {
        if (prior.payload.fingerprint !== fingerprint)
          throw new ConventionError(
            "Import key was already used for different content.",
            409,
          );
        return prior.payload;
      }
      if (edition.revision !== revision || edition.archived_at)
        throw new ConventionError(
          "List changed or archived. Preview the import again.",
          409,
        );
      const candidates = await this.candidates(c, members);
      let added = 0;
      for (const member of members) {
        const match = matchProfile(member, candidates);
        const inserted = await c.query(
          `INSERT INTO convention_members(edition_id,source_key,organization_id,contact_id,data)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(edition_id,source_key) DO NOTHING RETURNING id`,
          [
            id,
            member.sourceKey,
            match?.organizationId ?? null,
            match?.contactId ?? null,
            JSON.stringify(member),
          ],
        );
        added += inserted.rows.length;
      }
      const result = { fingerprint, added, retained: members.length - added };
      if (added)
        await c.query(
          "UPDATE convention_editions SET revision=revision+1 WHERE id=$1",
          [id],
        );
      await this.audit(c, id, null, "imported", actor, mutationKey, result);
      return result;
    });
  }
  async updateConventionResponse(
    id: string,
    memberId: string,
    revision: number,
    response: Member["conventionResponse"],
    actor: string,
  ) {
    return this.transaction(async (c) => {
      const edition = await this.edition(c, id);
      if (edition.archived_at)
        throw new ConventionError("This year is archived.", 409);
      const before = (
        await c.query(
          "SELECT * FROM convention_members WHERE id=$1 AND edition_id=$2 FOR UPDATE",
          [memberId, id],
        )
      ).rows[0];
      if (!before) throw new ConventionError("Contact not found.", 404);
      if (before.revision !== revision)
        throw new ConventionError(
          "This contact changed. Reload before saving.",
          409,
        );
      const member = validateMember({
        ...before.data,
        conventionResponse: response,
      });
      const after = (
        await c.query(
          `UPDATE convention_members SET data=$1,revision=revision+1,updated_at=now()
          WHERE id=$2 AND edition_id=$3 RETURNING *`,
          [JSON.stringify(member), memberId, id],
        )
      ).rows[0];
      await c.query(
        "UPDATE convention_editions SET revision=revision+1 WHERE id=$1",
        [id],
      );
      await this.audit(
        c,
        id,
        memberId,
        "convention_response",
        actor,
        randomUUID(),
        { before, after },
      );
      return after;
    });
  }
  async updateMember(
    id: string,
    memberId: string,
    revision: number,
    data: unknown,
    link: { organizationId: string | null; contactId: string | null },
    actor: string,
  ) {
    const member = validateMember(data);
    return this.transaction(async (c) => {
      const edition = await this.edition(c, id);
      if (edition.archived_at)
        throw new ConventionError("This year is archived.", 409);
      const before = (
        await c.query(
          "SELECT * FROM convention_members WHERE id=$1 AND edition_id=$2 FOR UPDATE",
          [memberId, id],
        )
      ).rows[0];
      if (!before) throw new ConventionError("Contact not found.", 404);
      if (before.revision !== revision)
        throw new ConventionError(
          "This contact changed. Reload before saving.",
          409,
        );
      if (member.sourceKey !== before.source_key)
        throw new ConventionError("The imported identity cannot be changed.");
      if (link.contactId && !link.organizationId)
        throw new ConventionError("Choose the event profile for this contact.");
      if (
        link.organizationId &&
        !(
          await c.query("SELECT id FROM organizations WHERE id=$1", [
            link.organizationId,
          ])
        ).rows.length
      )
        throw new ConventionError("Profile not found.", 404);
      if (
        link.contactId &&
        !(
          await c.query(
            `SELECT c.id FROM contacts c WHERE c.id=$1 AND (c.organization_id=$2 OR EXISTS
        (SELECT 1 FROM organization_contacts oc WHERE oc.contact_id=c.id AND oc.organization_id=$2 AND oc.active=true))`,
            [link.contactId, link.organizationId],
          )
        ).rows.length
      )
        throw new ConventionError(
          "Contact is not linked to this event profile.",
        );
      const after = (
        await c.query(
          `UPDATE convention_members SET data=$1,organization_id=$2,contact_id=$3,revision=revision+1,updated_at=now()
        WHERE id=$4 RETURNING *`,
          [
            JSON.stringify(member),
            link.organizationId,
            link.contactId,
            memberId,
          ],
        )
      ).rows[0];
      await c.query(
        "UPDATE convention_editions SET revision=revision+1 WHERE id=$1",
        [id],
      );
      await this.audit(c, id, memberId, "edited", actor, randomUUID(), {
        before,
        after,
      });
      return after;
    });
  }
  async rollover(id: string, revision: number, actor: string) {
    return this.transaction(async (c) => {
      const source = await this.edition(c, id, revision);
      const existing = (
        await c.query(
          "SELECT * FROM convention_editions WHERE convention=$1 AND year=$2",
          [source.convention, source.year + 1],
        )
      ).rows[0];
      if (existing) {
        if (existing.copied_from === id) return existing;
        throw new ConventionError(
          "Next year already exists. Review it before combining lists.",
          409,
        );
      }
      const next = (
        await c.query(
          "INSERT INTO convention_editions(convention,year,copied_from) VALUES($1,$2,$3) RETURNING *",
          [source.convention, source.year + 1, id],
        )
      ).rows[0];
      const rows = (
        await c.query("SELECT * FROM convention_members WHERE edition_id=$1", [
          id,
        ])
      ).rows;
      for (const row of rows)
        await c.query(
          "INSERT INTO convention_members(edition_id,source_key,organization_id,contact_id,data) VALUES($1,$2,$3,$4,$5)",
          [
            next.id,
            row.source_key,
            row.organization_id,
            row.contact_id,
            JSON.stringify(nextYearMember(validateMember(row.data))),
          ],
        );
      await this.audit(
        c,
        next.id,
        null,
        "carried_forward",
        actor,
        `rollover:${id}`,
        { sourceEdition: id, sourceRevision: revision, count: rows.length },
      );
      return next;
    });
  }
  async review(id: string, revision: number, note: string, actor: string) {
    return this.transaction(async (c) => {
      await this.edition(c, id, revision);
      await c.query(
        `INSERT INTO convention_reviews(edition_id,actor,reviewed_revision,note) VALUES($1,$2,$3,$4)
        ON CONFLICT(edition_id,actor) DO UPDATE SET reviewed_revision=$3,note=$4,reviewed_at=now()`,
        [id, actor, revision, note],
      );
      await this.audit(c, id, null, "reviewed", actor, randomUUID(), {
        revision,
        note,
      });
      return { saved: true };
    });
  }
  async profileHistory(organizationId: string) {
    return (
      await this.pool.query(
        `SELECT m.*,e.convention,e.year FROM convention_members m JOIN convention_editions e ON e.id=m.edition_id
      WHERE m.organization_id=$1 ORDER BY e.year DESC,e.convention`,
        [organizationId],
      )
    ).rows;
  }
  async updateEdition(
    id: string,
    revision: number,
    input: {
      summary: string;
      recommendation: string;
      sources: string;
      archived: boolean;
    },
    actor: string,
  ) {
    return this.transaction(async (c) => {
      const before = await this.edition(c, id, revision);
      const after = (
        await c.query(
          `UPDATE convention_editions SET summary=$2,recommendation=$3,sources=$4,
        archived_at=CASE WHEN $5 THEN coalesce(archived_at,now()) ELSE NULL END,revision=revision+1 WHERE id=$1 RETURNING *`,
          [
            id,
            input.summary,
            input.recommendation,
            input.sources,
            input.archived,
          ],
        )
      ).rows[0];
      await this.audit(c, id, null, "plan_updated", actor, randomUUID(), {
        before,
        after,
      });
      return after;
    });
  }
  async memberContext(editionId: string, memberId: string) {
    const member = (
      await this.pool.query(
        "SELECT * FROM convention_members WHERE id=$1 AND edition_id=$2",
        [memberId, editionId],
      )
    ).rows[0];
    if (!member) throw new ConventionError("Contact not found.", 404);
    if (!member.organization_id)
      return { activities: [], promotions: [], followUps: [], submissions: [] };
    const [activities, promotions, followUps, submissions] = await Promise.all([
      this.pool.query(
        `SELECT id,kind,subject,body,occurred_at FROM activities WHERE organization_id=$1
        AND deleted_at IS NULL ORDER BY timeline_sort_at DESC,id DESC LIMIT 50`,
        [member.organization_id],
      ),
      this.pool.query(
        `SELECT id,event_year,status,first_sent_at,deadline_date::text AS deadline_date,interest_confirmed_at,reminder_due_at,
        reminder_draft_id,deposit_received_at,cancel_reason FROM early_bird_promo_enrollments WHERE organization_id=$1 ORDER BY event_year DESC`,
        [member.organization_id],
      ),
      this.pool.query(
        `SELECT id,kind,due_at,completed_at,outcome FROM follow_ups WHERE organization_id=$1 ORDER BY due_at DESC LIMIT 50`,
        [member.organization_id],
      ),
      this.pool.query(
        `SELECT id,payload,created_at,applied_at FROM boss_convention_submissions WHERE applied_organization_id=$1
        AND applied_at IS NOT NULL ORDER BY created_at DESC LIMIT 50`,
        [member.organization_id],
      ),
    ]);
    return {
      activities: activities.rows,
      promotions: promotions.rows,
      followUps: followUps.rows,
      submissions: submissions.rows,
    };
  }
}
