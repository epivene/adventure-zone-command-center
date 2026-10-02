import { planningStartCalendar } from "./operational-window";
import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  planDraftSchema,
  legSeasonPlanInputSchema,
  crewAvailabilityInputSchema,
  packageSetInputSchema,
  splitGroupInputSchema,
  daveAuthorityInputSchema,
  approvalDecisionInputSchema,
  commitPlansInputSchema,
  revisionWriteSchema,
  approvalRequestInputSchema,
  decisionWriteInputSchema,
  type ApprovalRequestInput,
  type PlanningActor,
  type PlanDraft,
  type EventPlan,
  type RevisionWrite,
  type MutationResult,
  type PlanFacts,
  type PlanningRead,
  type PlanningCatalog,
  type LegSeasonPlanInput,
  type LegSeasonPlan,
  type CrewAvailabilityInput,
  type CrewAvailability,
  type PackageSetInput,
  type PackageSet,
  type SplitGroupInput,
  type SplitGroup,
  type DaveAuthorityInput,
  type DaveAuthority,
  type ApprovalRequest,
  type ApprovalDecisionInput,
  type ApprovalDecision,
} from "@workspace/api-zod";
import {
  DrizzlePlanningRepository,
  PlanningError,
  planningRows,
  eventPlanRow,
  actorKey,
  assertPlanningLeg,
  type PlanningDatabase,
} from "./planning-repository";
import { loadPlanFacts, planningFingerprint } from "./planning-facts";
import { evaluateApprovals, decisionAuthority } from "./approval-policy";
import { evaluatePlanReadiness } from "./readiness-policy";
import { resolveOperationalWindow } from "./operational-window";
import { toPlanningView } from "./planning-view";
import {
  operationsSeason,
  isImportedCalendarDate,
} from "../bookings/booking-leg-operations-history";
import {
  withAllocationTransaction,
  type AllocationDatabase,
} from "../outreach-planner/outreach-allocation";
import { finishCapacityWriteIn } from "../outreach-planner/outreach-commitments";
import {
  planningSnapshotIn,
  checkPlanningWriteIn,
} from "./planning-writer-hooks";

function owner(actor: PlanningActor) {
  if (actor.kind !== "owner") throw new PlanningError(403, "OWNER_REQUIRED");
}
function revision(actual: unknown, expected: number | null) {
  if ((actual ?? null) !== expected)
    throw new PlanningError(409, "STALE_REVISION");
}
function stableJSON(value: unknown): string {
  const normalize = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(normalize)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, normalize(x)]),
          )
        : v;
  return JSON.stringify(normalize(value));
}
export class LegPlanningService {
  readonly repository: DrizzlePlanningRepository;
  constructor(
    readonly database: AllocationDatabase,
    readonly clock = () => new Date(),
  ) {
    this.repository = new DrizzlePlanningRepository(database);
  }
  async facts(bookingId: string, actor: PlanningActor): Promise<PlanFacts[]> {
    return loadPlanFacts(this.database, [bookingId], actor, this.clock());
  }
  async get(
    bookingId: string,
    actor: PlanningActor,
  ): Promise<PlanningRead | null> {
    const [facts] = await this.facts(bookingId, actor);
    if (!facts) return null;
    return {
      ...toPlanningView(
        facts,
        actor,
        await this.repository.readBooking(bookingId, actor),
      ),
      catalog: await this.catalog(actor, facts),
    };
  }
  async catalog(
    actor: PlanningActor,
    known?: PlanFacts,
  ): Promise<PlanningCatalog> {
    const query = async (query: ReturnType<typeof sql>) =>
      planningRows<Record<string, any>>(await this.database.execute(query));
    const [
      legs,
      workers,
      availability,
      sets,
      resources,
      packages,
      bookings,
      memberships,
    ] = await Promise.all([
      query(
        actor.kind === "manager"
          ? sql`SELECT id,name FROM travel_legs WHERE id=${actor.legId}::uuid AND archived_at IS NULL`
          : sql`SELECT id,name FROM travel_legs WHERE archived_at IS NULL ORDER BY name`,
      ),
      query(sql`SELECT id,name,rehire_status FROM crew_workers`),
      query(sql`SELECT id,revision,payload FROM crew_availability`),
      query(sql`SELECT id,revision,payload FROM package_sets`),
      query(
        sql`SELECT id,name,category,status,minimum_transfer_minutes FROM resources`,
      ),
      query(
        sql`SELECT id,name,code,normal_capacity,temporary_unavailable_quantity FROM package_templates WHERE active=true`,
      ),
      query(
        actor.kind === "manager"
          ? sql`SELECT b.id,b.name,b.travel_leg_id,b.starts_at,EXISTS(SELECT 1 FROM google_operational_calendar_links c WHERE c.booking_id=b.id AND c.last_app_snapshot->>'imported'='true') AS imported_dates FROM bookings b WHERE travel_leg_id=${actor.legId}::uuid ORDER BY starts_at NULLS LAST,id`
          : sql`SELECT b.id,b.name,b.travel_leg_id,b.starts_at,EXISTS(SELECT 1 FROM google_operational_calendar_links c WHERE c.booking_id=b.id AND c.last_app_snapshot->>'imported'='true') AS imported_dates FROM bookings b ORDER BY starts_at NULLS LAST,id`,
      ),
      actor.kind === "manager"
        ? query(
            sql`SELECT worker_id FROM crew_worker_leg_memberships WHERE leg_id=${actor.legId}::uuid`,
          )
        : Promise.resolve([]),
    ]);
    const authorizedWorkers = new Set(memberships.map((m) => m.worker_id));
    const visibleSets = sets.filter(
      (s) =>
        actor.kind !== "manager" || known?.draft.packageSetIds.includes(s.id),
    );
    const resourceIds = new Set([
      ...visibleSets.flatMap((s) => s.payload.resourceIds),
      ...(known?.draft.transportResourceIds ?? []),
      ...(known?.season?.transportResourceIds ?? []),
      ...(actor.kind === "manager"
        ? (
            await query(
              sql`SELECT payload FROM leg_season_plans WHERE leg_id=${actor.legId}::uuid`,
            )
          ).flatMap((s) => s.payload.transportResourceIds ?? [])
        : []),
    ]);
    return {
      enabled: true,
      legs: legs.map((l) => ({ id: l.id, name: l.name })),
      workers: workers
        .filter((w) => actor.kind !== "manager" || authorizedWorkers.has(w.id))
        .map((w) => ({
          id: w.id,
          name: w.name,
          rehireStatus: w.rehire_status,
        })),
      availability: availability
        .filter(
          (a) =>
            actor.kind !== "manager" ||
            authorizedWorkers.has(a.payload.workerId),
        )
        .map((a) => ({ ...a.payload, id: a.id, revision: a.revision })),
      packageSets: visibleSets.map((s) => ({
        ...s.payload,
        id: s.id,
        revision: s.revision,
      })),
      resources: resources
        .filter((r) => actor.kind !== "manager" || resourceIds.has(r.id))
        .map((r) => ({
          id: r.id,
          name: r.name,
          category: r.category,
          status: r.status,
          minimumTransferMinutes: r.minimum_transfer_minutes,
        })),
      packages: packages.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        normalCapacity: p.normal_capacity,
        unavailableQuantity: p.temporary_unavailable_quantity,
      })),
      bookings: bookings.map((b) => ({
        splitSeasonYears: (() => {
          const p = planningStartCalendar(
            b.starts_at,
            isImportedCalendarDate(b.starts_at, b.imported_dates === true),
          );
          return p
            ? p.month === 1 && p.year > 1900
              ? [p.year, p.year - 1]
              : [p.year]
            : [];
        })(),
        id: b.id,
        name: b.name,
        legId: b.travel_leg_id,
        seasonYear: operationsSeason(
          b.starts_at,
          isImportedCalendarDate(b.starts_at, b.imported_dates),
        ),
      })),
      ...(actor.kind === "owner"
        ? {
            bossAccounts: (
              await query(
                sql`SELECT id,display_name FROM boss_accounts WHERE enabled=true ORDER BY display_name,id`,
              )
            ).map((b) => ({ id: b.id, name: b.display_name })),
          }
        : {}),
    };
  }
  readSeason(legId: string, year: number, actor: PlanningActor) {
    return this.repository.readSeason(legId, year, actor);
  }
  async listAvailability(actor: PlanningActor) {
    return (await this.catalog(actor)).availability;
  }
  async listPackageSets(actor: PlanningActor) {
    owner(actor);
    return (await this.catalog(actor)).packageSets;
  }
  async readDaveAuthority(actor: PlanningActor): Promise<DaveAuthority | null> {
    owner(actor);
    const [row] = planningRows(
      await this.database.execute(
        sql`SELECT account_id,revision FROM leg_plan_authorities WHERE singleton=1`,
      ),
    );
    return row
      ? {
          accountId: row.account_id as string | null,
          revision: Number(row.revision),
        }
      : null;
  }
  async listApprovals(actor: PlanningActor, requestId?: string) {
    const rows = planningRows<Record<string, any>>(
      await this.database.execute(
        actor.kind === "manager"
          ? sql`SELECT * FROM leg_plan_approval_requests WHERE parent_leg_id=${actor.legId}::uuid ORDER BY created_at DESC,id DESC LIMIT 100`
          : sql`SELECT * FROM leg_plan_approval_requests ORDER BY created_at DESC,id DESC LIMIT 100`,
      ),
    );
    const reviews = [];
    for (const row of rows.filter((r) => !requestId || r.id === requestId)) {
      const plans = [];
      for (const id of row.booking_ids as string[]) {
        try {
          const read = await this.get(id, actor);
          if (read) plans.push(read);
        } catch (e) {
          if (e instanceof PlanningError && e.status === 403) continue;
          throw e;
        }
      }
      if (plans.length === row.booking_ids.length)
        reviews.push({
          canDecide:
            actor.kind !== "owner" &&
            (actor.kind !== "manager" || row.type === "split") &&
            plans.every((p) => p.actions.decide),
          request: {
            id: row.id,
            type: row.type,
            bookingIds: row.booking_ids,
            parentLegId: row.parent_leg_id,
            planFingerprint: row.plan_fingerprint,
            state: row.state,
            revision: row.revision,
            createdAt: new Date(row.created_at).toISOString(),
          } as ApprovalRequest,
          plans,
        });
    }
    return reviews;
  }
  private async mutation<T>(
    actor: PlanningActor,
    operation: string,
    input: { requestKey: string },
    work: (
      tx: PlanningDatabase,
    ) => Promise<{ value: T; affectedBookingIds: string[] }>,
    authorize?: (tx: PlanningDatabase) => Promise<void>,
  ): Promise<MutationResult<T>> {
    const hash = createHash("sha256")
      .update(JSON.stringify({ operation, input }))
      .digest("hex");
    return withAllocationTransaction(
      this.database,
      async (tx) => {
        const scopedResult = async (
          result: MutationResult<T>,
        ): Promise<MutationResult<T>> => {
          if (actor.kind !== "manager" || !result.affectedBookingIds.length)
            return result;
          const own = new Set(
            planningRows<{ id: string }>(
              await tx.execute(
                sql`SELECT id FROM bookings WHERE travel_leg_id=${actor.legId}::uuid`,
              ),
            ).map((b) => b.id),
          );
          return {
            ...result,
            affectedBookingIds: result.affectedBookingIds.filter((id) =>
              own.has(id),
            ),
          };
        };
        await authorize?.(tx);
        const [receipt] = planningRows(
          await tx.execute(
            sql`SELECT * FROM leg_plan_mutation_receipts WHERE actor_key=${actorKey(actor)} AND request_key=${input.requestKey}`,
          ),
        );
        if (receipt) {
          if (receipt.body_hash !== hash)
            throw new PlanningError(409, "REQUEST_KEY_REUSED");
          await tx.execute(
            sql`UPDATE outreach_write_receipts SET validated=true WHERE transaction_id=txid_current()`,
          );
          return scopedResult({
            ...(receipt.result as MutationResult<T>),
            idempotent: true,
          });
        }
        const result = await work(tx);
        const value: MutationResult<T> = await scopedResult({
          receiptId: randomUUID(),
          ...result,
          idempotent: false,
        });
        await tx.execute(
          sql`INSERT INTO leg_plan_mutation_receipts(id,actor_key,request_key,body_hash,result) VALUES(${value.receiptId}::uuid,${actorKey(actor)},${input.requestKey},${hash},${JSON.stringify(value)}::jsonb)`,
        );
        await finishCapacityWriteIn(tx);
        return value;
      },
      { mode: "commitment", source: `leg-planning:${operation}` },
    );
  }
  async saveDraft(
    actor: PlanningActor,
    input: RevisionWrite<PlanDraft>,
  ): Promise<MutationResult<EventPlan>> {
    const parsed = revisionWriteSchema(planDraftSchema).parse(input);
    assertPlanningLeg(actor, parsed.payload.legId);
    return this.mutation(
      actor,
      "draft",
      parsed,
      async (tx) => {
        const previous = await new DrizzlePlanningRepository(tx).readBooking(
          parsed.payload.bookingId,
          actor,
        );
        const payload = structuredClone(parsed.payload);
        if (
          actor.kind === "manager" &&
          (payload.packageSetIds.some(
            (id) => !previous?.draft.packageSetIds.includes(id),
          ) ||
            payload.transportResourceIds.some(
              (id) => !previous?.draft.transportResourceIds.includes(id),
            ))
        )
          throw new PlanningError(403, "OFFICE_INVENTORY_ASSIGNMENT_REQUIRED");
        for (const crew of payload.crew)
          await this.workerIn(tx, crew.workerId, actor);
        if (payload.travelReview) {
          const old = previous?.draft.travelReview;
          payload.travelReview.reviewedAt =
            old &&
            old.endpointFingerprint ===
              payload.travelReview.endpointFingerprint &&
            JSON.stringify(old.source) ===
              JSON.stringify(payload.travelReview.source)
              ? old.reviewedAt
              : this.clock().toISOString();
        }
        const value = await this.repository.saveDraftIn(
          tx,
          payload,
          parsed.expectedRevision,
        );
        return {
          value,
          affectedBookingIds: [
            payload.bookingId,
            ...(value.draft.splitGroupId
              ? planningRows<{ booking_a_id: string; booking_b_id: string }>(
                  await tx.execute(
                    sql`SELECT booking_a_id,booking_b_id FROM leg_plan_splits WHERE id=${value.draft.splitGroupId}::uuid`,
                  ),
                ).flatMap((r) => [r.booking_a_id, r.booking_b_id])
              : []),
          ],
        };
      },
      async (tx) => {
        await this.repository.authorizeBookingIn(
          tx,
          parsed.payload.bookingId,
          actor,
        );
      },
    );
  }
  async saveSeason(
    actor: PlanningActor,
    input: RevisionWrite<LegSeasonPlanInput>,
  ): Promise<MutationResult<LegSeasonPlan>> {
    const p = revisionWriteSchema(legSeasonPlanInputSchema).parse(input);
    assertPlanningLeg(actor, p.payload.legId);
    return this.mutation(actor, "season", p, async (tx) => {
      const [leg] = planningRows(
        await tx.execute(
          sql`SELECT id FROM travel_legs WHERE id=${p.payload.legId}::uuid AND archived_at IS NULL FOR UPDATE`,
        ),
      );
      if (!leg) throw new PlanningError(422, "LEG_UNAVAILABLE");
      if (
        p.payload.leadership === "confirmed" &&
        !p.payload.managerWorkerId &&
        !p.payload.managerName
      )
        throw new PlanningError(422, "MANAGER_REQUIRED");
      const [row] = planningRows(
        await tx.execute(
          sql`SELECT revision,payload FROM leg_season_plans WHERE leg_id=${p.payload.legId}::uuid AND season_year=${p.payload.seasonYear} FOR UPDATE`,
        ),
      );
      revision(row?.revision, p.expectedRevision);
      if (
        actor.kind === "manager" &&
        p.payload.transportResourceIds.some(
          (id) =>
            !(
              (row?.payload as LegSeasonPlanInput | undefined)
                ?.transportResourceIds ?? []
            ).includes(id),
        )
      )
        throw new PlanningError(403, "INVENTORY_SCOPE_REQUIRED");
      for (const id of [
        ...p.payload.workerIds,
        ...(p.payload.managerWorkerId ? [p.payload.managerWorkerId] : []),
      ])
        await this.workerIn(tx, id, actor);
      for (const id of p.payload.transportResourceIds)
        await this.resourceIn(tx, id);
      if (row && stableJSON(row.payload) === stableJSON(p.payload))
        return {
          value: { ...p.payload, revision: Number(row.revision) },
          affectedBookingIds: [],
        };
      const before = await planningSnapshotIn(tx);
      const [saved] = planningRows(
        await tx.execute(
          sql`INSERT INTO leg_season_plans(leg_id,season_year,payload) VALUES(${p.payload.legId}::uuid,${p.payload.seasonYear},${JSON.stringify(p.payload)}::jsonb) ON CONFLICT(leg_id,season_year) DO UPDATE SET payload=EXCLUDED.payload,revision=leg_season_plans.revision+1,updated_at=now() RETURNING revision`,
        ),
      );
      await checkPlanningWriteIn(
        tx,
        before,
        await planningSnapshotIn(tx),
        "reconciliation",
      );
      return {
        value: { ...p.payload, revision: Number(saved.revision) },
        affectedBookingIds: before
          .filter((f) => f.draft.legId === p.payload.legId)
          .map((f) => f.booking.id),
      };
    });
  }
  private async workerIn(
    tx: PlanningDatabase,
    id: string,
    actor: PlanningActor,
  ) {
    const [worker] = planningRows(
      await tx.execute(sql`SELECT id FROM crew_workers WHERE id=${id}::uuid`),
    );
    if (!worker) throw new PlanningError(422, "WORKER_NOT_FOUND");
    if (actor.kind === "manager") {
      const [membership] = planningRows(
        await tx.execute(
          sql`SELECT worker_id FROM crew_worker_leg_memberships WHERE worker_id=${id}::uuid AND leg_id=${actor.legId}::uuid`,
        ),
      );
      if (!membership) throw new PlanningError(403, "OUTSIDE_LEG");
    }
  }
  private async resourceIn(tx: PlanningDatabase, id: string) {
    const [row] = planningRows(
      await tx.execute(sql`SELECT * FROM resources WHERE id=${id}::uuid`),
    );
    if (!row) throw new PlanningError(422, "RESOURCE_NOT_FOUND");
    return row;
  }
  async saveAvailability(
    actor: PlanningActor,
    input: RevisionWrite<CrewAvailabilityInput>,
  ): Promise<MutationResult<CrewAvailability>> {
    const p = revisionWriteSchema(crewAvailabilityInputSchema).parse(input);
    return this.mutation(
      actor,
      "availability",
      p,
      async (tx) => {
        const [row] = p.payload.id
          ? planningRows(
              await tx.execute(
                sql`SELECT * FROM crew_availability WHERE id=${p.payload.id}::uuid FOR UPDATE`,
              ),
            )
          : [];
        if (row) await this.workerIn(tx, String(row.worker_id), actor);
        revision(row?.revision, p.expectedRevision);
        const window = resolveOperationalWindow(p.payload.window);
        if (window.state !== "resolved")
          throw new PlanningError(422, "INVALID_WINDOW");
        const id = p.payload.id ?? randomUUID(),
          next = Number(row?.revision ?? 0) + 1;
        const before = await planningSnapshotIn(tx);
        const value: CrewAvailability = { ...p.payload, id, revision: next };
        await tx.execute(
          sql`INSERT INTO crew_availability(id,worker_id,starts_at,ends_at,state,payload,revision) VALUES(${id}::uuid,${p.payload.workerId}::uuid,${new Date(window.window.startMs).toISOString()}::timestamptz,${new Date(window.window.endMs).toISOString()}::timestamptz,${p.payload.state},${JSON.stringify(value)}::jsonb,${next}) ON CONFLICT(id) DO UPDATE SET worker_id=EXCLUDED.worker_id,starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,state=EXCLUDED.state,payload=EXCLUDED.payload,revision=EXCLUDED.revision`,
        );
        await checkPlanningWriteIn(
          tx,
          before,
          await planningSnapshotIn(tx),
          "reconciliation",
        );
        return {
          value,
          affectedBookingIds: before
            .filter((f) =>
              f.draft.crew.some((c) => c.workerId === p.payload.workerId),
            )
            .map((f) => f.booking.id),
        };
      },
      (tx) => this.workerIn(tx, p.payload.workerId, actor),
    );
  }
  async savePackageSet(
    actor: PlanningActor,
    input: RevisionWrite<PackageSetInput>,
  ): Promise<MutationResult<PackageSet>> {
    owner(actor);
    const p = revisionWriteSchema(packageSetInputSchema).parse(input);
    return this.mutation(actor, "package-set", p, async (tx) => {
      const [row] = p.payload.id
        ? planningRows(
            await tx.execute(
              sql`SELECT * FROM package_sets WHERE id=${p.payload.id}::uuid FOR UPDATE`,
            ),
          )
        : [];
      revision(row?.revision, p.expectedRevision);
      const [pkg] = planningRows(
        await tx.execute(
          sql`SELECT * FROM package_templates WHERE id=${p.payload.packageId}::uuid AND active=true`,
        ),
      );
      if (!pkg) throw new PlanningError(422, "PACKAGE_NOT_FOUND");
      if (new Set(p.payload.resourceIds).size !== p.payload.resourceIds.length)
        throw new PlanningError(422, "DUPLICATE_RESOURCE");
      const resources: Record<string, unknown>[] = [];
      for (const id of p.payload.resourceIds)
        resources.push(await this.resourceIn(tx, id));
      if (
        p.payload.verify &&
        (!p.payload.source ||
          !Object.keys(p.payload.requirements).length ||
          Object.entries(p.payload.requirements).some(
            ([category, count]) =>
              resources.filter(
                (r) => r.category === category && r.status === "available",
              ).length < count,
          ))
      )
        throw new PlanningError(422, "INCOMPLETE_PACKAGE_SET");
      if (p.payload.verify && p.payload.classification === "normal") {
        const limits: Record<string, number> = {
          adventure_zone: 5,
          pirates_rebellion: 3,
          pirate_rebellion: 3,
          weekend_warriors: 1,
          warriors_playground: 1,
        };
        const normal = planningRows<{ id: string; payload: PackageSet }>(
          await tx.execute(
            sql`SELECT id,payload FROM package_sets WHERE package_id=${p.payload.packageId}::uuid`,
          ),
        ).filter(
          (s) =>
            s.id !== p.payload.id &&
            s.payload.state === "verified" &&
            s.payload.classification === "normal",
        );
        if (
          normal.length >=
          Math.min(
            limits[String(pkg.code)] ?? Number(pkg.normal_capacity),
            Number(pkg.normal_capacity),
          )
        )
          throw new PlanningError(422, "NORMAL_SET_LIMIT");
        if (
          normal.some((s) =>
            s.payload.resourceIds.some((id) =>
              p.payload.resourceIds.includes(id),
            ),
          )
        )
          throw new PlanningError(422, "PHYSICAL_SET_ALREADY_VERIFIED");
      }
      const id = p.payload.id ?? randomUUID(),
        next = Number(row?.revision ?? 0) + 1;
      const before = await planningSnapshotIn(tx);
      const { verify, ...payload } = p.payload;
      const value: PackageSet = {
        ...payload,
        id,
        revision: next,
        state: verify ? "verified" : "unverified",
        verifiedBy: verify ? actorKey(actor) : null,
        verifiedAt: verify ? this.clock().toISOString() : null,
      };
      await tx.execute(
        sql`INSERT INTO package_sets(id,package_id,payload,revision) VALUES(${id}::uuid,${payload.packageId}::uuid,${JSON.stringify(value)}::jsonb,${next}) ON CONFLICT(id) DO UPDATE SET package_id=EXCLUDED.package_id,payload=EXCLUDED.payload,revision=EXCLUDED.revision`,
      );
      await tx.execute(
        sql`DELETE FROM package_set_members WHERE set_id=${id}::uuid`,
      );
      for (const resourceId of value.resourceIds)
        await tx.execute(
          sql`INSERT INTO package_set_members(set_id,resource_id) VALUES(${id}::uuid,${resourceId}::uuid)`,
        );
      await checkPlanningWriteIn(
        tx,
        before,
        await planningSnapshotIn(tx),
        "reconciliation",
      );
      return {
        value,
        affectedBookingIds: before
          .filter((f) => f.draft.packageSetIds.includes(id))
          .map((f) => f.booking.id),
      };
    });
  }
  async saveSplit(
    actor: PlanningActor,
    input: RevisionWrite<SplitGroupInput>,
  ): Promise<MutationResult<SplitGroup>> {
    const p = revisionWriteSchema(splitGroupInputSchema).parse(input);
    assertPlanningLeg(actor, p.payload.parentLegId);
    return this.mutation(
      actor,
      "split",
      p,
      async (tx) => {
        const [row] = p.payload.id
          ? planningRows(
              await tx.execute(
                sql`SELECT * FROM leg_plan_splits WHERE id=${p.payload.id}::uuid FOR UPDATE`,
              ),
            )
          : [];
        revision(row?.revision, p.expectedRevision);
        if (row) assertPlanningLeg(actor, String(row.parent_leg_id));
        const id = p.payload.id ?? randomUUID();
        const duplicates = planningRows(
          await tx.execute(
            sql`SELECT id FROM leg_plan_splits WHERE id<>${id}::uuid AND (booking_a_id IN (${p.payload.bookingIds[0]}::uuid,${p.payload.bookingIds[1]}::uuid) OR booking_b_id IN (${p.payload.bookingIds[0]}::uuid,${p.payload.bookingIds[1]}::uuid))`,
          ),
        );
        if (duplicates.length)
          throw new PlanningError(409, "BOOKING_ALREADY_IN_SPLIT");
        const value: SplitGroup = {
          ...p.payload,
          id,
          revision: Number(row?.revision ?? 0) + 1,
        };
        await tx.execute(
          sql`INSERT INTO leg_plan_splits(id,parent_leg_id,booking_a_id,booking_b_id,revision) VALUES(${id}::uuid,${value.parentLegId}::uuid,${value.bookingIds[0]}::uuid,${value.bookingIds[1]}::uuid,${value.revision}) ON CONFLICT(id) DO UPDATE SET parent_leg_id=EXCLUDED.parent_leg_id,booking_a_id=EXCLUDED.booking_a_id,booking_b_id=EXCLUDED.booking_b_id,revision=EXCLUDED.revision`,
        );
        return { value, affectedBookingIds: [...value.bookingIds] };
      },
      async (tx) => {
        for (const id of p.payload.bookingIds)
          await this.repository.authorizeBookingIn(tx, id, actor);
      },
    );
  }
  async saveDaveAuthority(
    actor: PlanningActor,
    input: RevisionWrite<DaveAuthorityInput>,
  ): Promise<MutationResult<DaveAuthority>> {
    owner(actor);
    const p = revisionWriteSchema(daveAuthorityInputSchema).parse(input);
    return this.mutation(actor, "dave-authority", p, async (tx) => {
      const [row] = planningRows(
        await tx.execute(
          sql`SELECT * FROM leg_plan_authorities WHERE singleton=1 FOR UPDATE`,
        ),
      );
      revision(row?.revision, p.expectedRevision);
      if (p.payload.accountId) {
        const [boss] = planningRows(
          await tx.execute(
            sql`SELECT id FROM boss_accounts WHERE id=${p.payload.accountId}::uuid AND enabled=true`,
          ),
        );
        if (!boss) throw new PlanningError(422, "ACCOUNT_UNAVAILABLE");
      }
      if (row && row.account_id === p.payload.accountId)
        return {
          value: { ...p.payload, revision: Number(row.revision) },
          affectedBookingIds: [],
        };
      const value: DaveAuthority = {
        ...p.payload,
        revision: Number(row?.revision ?? 0) + 1,
      };
      await tx.execute(
        sql`INSERT INTO leg_plan_authorities(singleton,account_id,revision) VALUES(1,${value.accountId}::uuid,${value.revision}) ON CONFLICT(singleton) DO UPDATE SET account_id=EXCLUDED.account_id,revision=EXCLUDED.revision`,
      );
      return {
        value,
        affectedBookingIds: (await planningSnapshotIn(tx)).map(
          (f) => f.booking.id,
        ),
      };
    });
  }
  async requestApproval(
    actor: PlanningActor,
    input: RevisionWrite<ApprovalRequestInput>,
  ): Promise<MutationResult<ApprovalRequest>> {
    const p = revisionWriteSchema(approvalRequestInputSchema).parse(input);
    assertPlanningLeg(actor, p.payload.parentLegId);
    return this.mutation(
      actor,
      "approval-request",
      p,
      async (tx) => {
        if (p.expectedRevision !== null)
          throw new PlanningError(409, "STALE_REVISION");
        const facts = await loadPlanFacts(
          tx,
          p.payload.bookingIds,
          actor,
          this.clock(),
        );
        if (
          facts.some(
            (f) => f.draft.legId !== p.payload.parentLegId || f.revision === 0,
          )
        )
          throw new PlanningError(422, "SAVE_PLAN_FIRST");
        if (
          p.payload.type === "split" &&
          (facts.length !== 2 ||
            !facts[0].split ||
            facts.some((f) => f.split?.id !== facts[0].split?.id) ||
            facts[0].split.bookingIds.some(
              (id) => !p.payload.bookingIds.includes(id),
            ))
        )
          throw new PlanningError(422, "EXACT_SPLIT_REQUIRED");
        if (p.payload.type !== "split" && facts.length !== 1)
          throw new PlanningError(422, "EXACT_EXTRA_PLAN_REQUIRED");
        if (p.payload.type !== "split") {
          const code =
            p.payload.type === "extra_adventure_zone"
              ? "adventure_zone"
              : "pirates_rebellion";
          if (
            !facts[0].packageSets.some(
              (s) =>
                s.classification === "extra" &&
                facts[0].draft.packageSetIds.includes(s.id) &&
                facts[0].packages.some(
                  (pkg) => pkg.id === s.packageId && pkg.code === code,
                ),
            )
          )
            throw new PlanningError(422, "EXTRA_PHYSICAL_SET_REQUIRED");
        }
        const fingerprint = createHash("sha256")
          .update(facts.map(planningFingerprint).sort().join(":"))
          .digest("hex");
        const duplicate = planningRows(
          await tx.execute(
            sql`SELECT id FROM leg_plan_approval_requests WHERE type=${p.payload.type} AND parent_leg_id=${p.payload.parentLegId}::uuid AND plan_fingerprint=${fingerprint} AND booking_ids @> ${JSON.stringify(p.payload.bookingIds)}::jsonb`,
          ),
        );
        if (
          duplicate.some((row) => {
            const request = facts[0].requests.find((r) => r.id === row.id);
            return (
              !request ||
              evaluateApprovals({ ...facts[0], requests: [request] }).state !==
                "invalid"
            );
          })
        )
          throw new PlanningError(409, "REQUEST_ALREADY_EXISTS");
        const id = randomUUID(),
          value: ApprovalRequest = {
            ...p.payload,
            id,
            planFingerprint: fingerprint,
            state: "pending",
            revision: 1,
            createdAt: this.clock().toISOString(),
          };
        await tx.execute(
          sql`INSERT INTO leg_plan_approval_requests(id,parent_leg_id,type,booking_ids,plan_fingerprint,created_at) VALUES(${id}::uuid,${value.parentLegId}::uuid,${value.type},${JSON.stringify(value.bookingIds)}::jsonb,${fingerprint},${value.createdAt}::timestamptz)`,
        );
        return { value, affectedBookingIds: value.bookingIds };
      },
      async (tx) => {
        for (const id of p.payload.bookingIds)
          await this.repository.authorizeBookingIn(tx, id, actor);
      },
    );
  }
  async decideApproval(
    actor: PlanningActor,
    input: RevisionWrite<{
      requestId: string;
      decision: ApprovalDecisionInput;
    }>,
  ): Promise<MutationResult<ApprovalDecision>> {
    const p = revisionWriteSchema(decisionWriteInputSchema).parse(input);
    return this.mutation(
      actor,
      "approval-decision",
      p,
      async (tx) => {
        const [row] = planningRows(
          await tx.execute(
            sql`SELECT revision,booking_ids FROM leg_plan_approval_requests WHERE id=${p.payload.requestId}::uuid FOR UPDATE`,
          ),
        );
        if (!row) throw new PlanningError(404, "REQUEST_NOT_FOUND");
        revision(row.revision, p.expectedRevision);
        const value = await this.repository.appendDecisionIn(
          tx,
          p.payload.requestId,
          actor,
          p.payload.decision,
        );
        return { value, affectedBookingIds: row.booking_ids as string[] };
      },
      async (tx) => {
        const [r] = planningRows(
          await tx.execute(
            sql`SELECT parent_leg_id FROM leg_plan_approval_requests WHERE id=${p.payload.requestId}::uuid`,
          ),
        );
        if (!r) throw new PlanningError(404, "REQUEST_NOT_FOUND");
        assertPlanningLeg(actor, String(r.parent_leg_id));
      },
    );
  }
  async commitPlans(
    actor: PlanningActor,
    input: {
      bookingIds: string[];
      expectedRevisions: Record<string, number>;
      requestKey: string;
    },
  ): Promise<MutationResult<EventPlan[]>> {
    const p = commitPlansInputSchema.parse(input);
    if (
      new Set(p.bookingIds).size !== p.bookingIds.length ||
      Object.keys(p.expectedRevisions).sort().join() !==
        p.bookingIds.slice().sort().join()
    )
      throw new PlanningError(422, "EXACT_REVISIONS_REQUIRED");
    return this.mutation(
      actor,
      "commit",
      p,
      async (tx) => {
        let facts = await loadPlanFacts(tx, p.bookingIds, actor, this.clock());
        for (const f of facts) {
          revision(f.revision || null, p.expectedRevisions[f.booking.id]);
          if (["completed", "cancelled", "declined"].includes(f.booking.status))
            throw new PlanningError(422, "BOOKING_CLOSED");
          const precheck = evaluatePlanReadiness(f, evaluateApprovals(f));
          // The live precheck prevents overwriting a longer window before the final staged check.
          if (precheck.dimensions.dates_travel.state !== "verified_plan")
            throw new PlanningError(
              422,
              "PLAN_NOT_READY",
              "Review the dates and travel evidence before committing.",
            );
          if (
            f.draft.splitGroupId &&
            (!f.split ||
              f.split.bookingIds.some((id) => !p.bookingIds.includes(id)))
          )
            throw new PlanningError(422, "COMMIT_BOTH_SPLIT_BRANCHES");
        }
        if (
          facts.length === 2 &&
          (!facts[0].split ||
            facts.some((f) => f.split?.id !== facts[0].split!.id))
        )
          throw new PlanningError(422, "EXACT_SPLIT_REQUIRED");
        const legIds = [...new Set(facts.map((f) => f.draft.legId))].sort();
        const workerIds = [
          ...new Set(facts.flatMap((f) => f.draft.crew.map((c) => c.workerId))),
        ].sort();
        const resourceIds = [
          ...new Set(
            facts.flatMap((f) => [
              ...f.draft.transportResourceIds,
              ...f.packageSets
                .filter((s) => f.draft.packageSetIds.includes(s.id))
                .flatMap((s) => s.resourceIds),
            ]),
          ),
        ].sort();
        for (const id of legIds)
          await tx.execute(
            sql`SELECT id FROM travel_legs WHERE id=${id}::uuid FOR UPDATE`,
          );
        for (const id of workerIds)
          await tx.execute(
            sql`SELECT id FROM crew_workers WHERE id=${id}::uuid FOR UPDATE`,
          );
        for (const id of resourceIds)
          await tx.execute(
            sql`SELECT id FROM resources WHERE id=${id}::uuid FOR UPDATE`,
          );
        await tx.execute(
          sql`SELECT singleton FROM leg_plan_authorities WHERE singleton=1 FOR SHARE`,
        );
        await tx.execute(
          sql`SELECT id FROM boss_accounts WHERE id=(SELECT account_id FROM leg_plan_authorities WHERE singleton=1) FOR SHARE`,
        );
        for (const id of legIds)
          await tx.execute(
            sql`SELECT leg_id FROM leg_manager_access WHERE leg_id=${id}::uuid FOR SHARE`,
          );
        const before = await planningSnapshotIn(tx);
        for (const f of facts) {
          const window =
            f.draft.window && resolveOperationalWindow(f.draft.window);
          if (!window || window.state !== "resolved")
            throw new PlanningError(422, "INVALID_WINDOW");
          await tx.execute(
            sql`UPDATE bookings SET travel_leg_id=${f.draft.legId}::uuid,updated_at=now() WHERE id=${f.booking.id}::uuid`,
          );
          await tx.execute(
            sql`INSERT INTO booking_operational_windows(booking_id,starts_at,ends_at,source) VALUES(${f.booking.id}::uuid,${new Date(window.window.startMs).toISOString()}::timestamptz,${new Date(window.window.endMs).toISOString()}::timestamptz,'manual') ON CONFLICT(booking_id) DO UPDATE SET starts_at=EXCLUDED.starts_at,ends_at=EXCLUDED.ends_at,source=EXCLUDED.source`,
          );
          await tx.execute(
            sql`DELETE FROM booking_resource_assignments WHERE booking_id=${f.booking.id}::uuid`,
          );
          const items = [
            ...new Set([
              ...f.draft.transportResourceIds,
              ...f.packageSets
                .filter((s) => f.draft.packageSetIds.includes(s.id))
                .flatMap((s) => s.resourceIds),
            ]),
          ];
          for (const id of items)
            await tx.execute(
              sql`INSERT INTO booking_resource_assignments(booking_id,resource_id,attribution_source) VALUES(${f.booking.id}::uuid,${id}::uuid,'manual')`,
            );
          await tx.execute(
            sql`DELETE FROM leg_plan_crew_commitments WHERE booking_id=${f.booking.id}::uuid`,
          );
          for (const c of f.draft.crew) {
            const shift = resolveOperationalWindow(c.window);
            if (c.state !== "confirmed" || shift.state !== "resolved")
              throw new PlanningError(422, "UNCONFIRMED_CREW");
            await tx.execute(
              sql`INSERT INTO leg_plan_crew_commitments(booking_id,worker_id,leg_id,role,starts_at,ends_at) VALUES(${f.booking.id}::uuid,${c.workerId}::uuid,${f.draft.legId}::uuid,${c.role},${new Date(shift.window.startMs).toISOString()}::timestamptz,${new Date(shift.window.endMs).toISOString()}::timestamptz)`,
            );
          }
          await tx.execute(
            sql`UPDATE leg_event_plans SET committed=draft,invalidation_reasons='[]'::jsonb WHERE booking_id=${f.booking.id}::uuid`,
          );
        }
        facts = await loadPlanFacts(tx, p.bookingIds, actor, this.clock());
        const readies = facts.map((f) =>
          evaluatePlanReadiness(f, evaluateApprovals(f)),
        );
        const r =
          readies.find((r) => r.overall === "conflict") ??
          readies.find((r) => r.overall !== "verified_plan");
        if (r)
          throw new PlanningError(
            r.overall === "conflict" ? 409 : 422,
            "PLAN_NOT_READY",
            actor.kind === "manager"
              ? "Review the operational plan before committing."
              : Object.values(r.dimensions)
                  .flatMap((d) => d.reasons.map((r) => r.message))
                  .join(" "),
          );
        await checkPlanningWriteIn(
          tx,
          before,
          await planningSnapshotIn(tx),
          "reconciliation",
        );
        const value: EventPlan[] = [];
        for (const id of p.bookingIds.slice().sort()) {
          const [row] = planningRows(
            await tx.execute(
              sql`UPDATE leg_event_plans SET revision=revision+1,invalidation_reasons='[]'::jsonb,updated_at=now() WHERE booking_id=${id}::uuid RETURNING *`,
            ),
          );
          value.push(eventPlanRow(row));
        }
        return {
          value,
          affectedBookingIds: [
            ...new Set([...p.bookingIds, ...before.map((f) => f.booking.id)]),
          ],
        };
      },
      async (tx) => {
        for (const id of p.bookingIds)
          await this.repository.authorizeBookingIn(tx, id, actor);
      },
    );
  }
}
