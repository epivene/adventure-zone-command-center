import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { bookings, tripSegments, trips } from "@/db/schema";
import { DrizzleFinanceRepository } from "./finance-repository";
import type {
  AdminExpenseFilters,
  AdminExpenseRow,
  AdminExpenseUpdateInput,
  FinanceAuditActor,
  FinanceAuditView,
  FinanceAssignmentSource,
} from "./admin-finance-types";

function resultRows<T>(value: unknown): T[] { return ((value as { rows?: T[] }).rows ?? []) as T[]; }
function asDate(value: unknown): Date { return value instanceof Date ? value : new Date(String(value)); }
function nullableDate(value: unknown): Date | null { return value == null ? null : asDate(value); }
function normalize(row: any): AdminExpenseRow {
  return {
    id: String(row.id), legId: String(row.legId), legName: String(row.legName), submitterName: row.submitterName ?? null,
    bookingId: row.bookingId ?? null, bookingName: row.bookingName ?? null, tripId: row.tripId ?? null, tripSegmentId: row.tripSegmentId ?? null,
    assignmentSource: String(row.assignmentSource ?? "unassigned") as FinanceAssignmentSource,
    assignmentReason: row.assignmentReason ?? null, assignmentUpdatedAt: nullableDate(row.assignmentUpdatedAt),
    merchant: row.merchant ?? null, category: String(row.category), amountCents: Number(row.amountCents), taxCents: Number(row.taxCents ?? 0),
    paymentSource: String(row.paymentSource), occurredAt: asDate(row.occurredAt), notes: row.notes ?? null, employeeNote: row.employeeNote ?? null,
    createdAt: asDate(row.createdAt), updatedAt: asDate(row.updatedAt), receiptId: row.receiptId ?? null,
    receiptObjectKey: row.receiptObjectKey ?? null, receiptImageStatus: row.receiptImageStatus ?? null,
    receiptMimeType: row.receiptMimeType ?? null, receiptCreatedAt: nullableDate(row.receiptCreatedAt),
  };
}

export class DrizzleAdminFinanceRepository {
  private readonly baseFinance: DrizzleFinanceRepository;
  constructor(private readonly database: NodePgDatabase<typeof schema>) {
    this.baseFinance = new DrizzleFinanceRepository(database);
  }

  summary(legId: string | null, tripId?: string | null) { return this.baseFinance.summary(legId, tripId); }

  private async refsBelongToLeg(legId: string, refs: { bookingId: string | null; tripId: string | null; tripSegmentId: string | null }) {
    if (refs.bookingId) {
      const found = await this.database.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.id, refs.bookingId), eq(bookings.travelLegId, legId))).limit(1);
      if (!found[0]) return false;
    }
    if (refs.tripId) {
      const found = await this.database.select({ id: trips.id }).from(trips).where(and(eq(trips.id, refs.tripId), eq(trips.travelLegId, legId))).limit(1);
      if (!found[0]) return false;
    }
    if (refs.tripSegmentId) {
      const found = await this.database.select({ id: tripSegments.id }).from(tripSegments).innerJoin(trips, eq(trips.id, tripSegments.tripId))
        .where(and(eq(tripSegments.id, refs.tripSegmentId), eq(trips.travelLegId, legId))).limit(1);
      if (!found[0]) return false;
    }
    return true;
  }

  async listAdminExpenses(filters: AdminExpenseFilters = {}): Promise<AdminExpenseRow[]> {
    const result = await this.database.execute(sql`
      SELECT e.id, e.leg_id AS "legId", tl.name AS "legName",
        COALESCE(e.submitted_by_label, lma.manager_name) AS "submitterName",
        e.booking_id AS "bookingId", b.name AS "bookingName", e.trip_id AS "tripId", e.trip_segment_id AS "tripSegmentId",
        COALESCE(e.assignment_source, 'unassigned') AS "assignmentSource", e.assignment_reason AS "assignmentReason",
        e.assignment_updated_at AS "assignmentUpdatedAt", e.merchant, e.category, e.amount_cents AS "amountCents",
        e.tax_cents AS "taxCents", e.payment_source AS "paymentSource", e.occurred_at AS "occurredAt", e.notes,
        e.employee_note AS "employeeNote", e.created_at AS "createdAt", e.updated_at AS "updatedAt",
        r.id AS "receiptId", r.object_key AS "receiptObjectKey", r.image_status AS "receiptImageStatus",
        r.mime_type AS "receiptMimeType", r.created_at AS "receiptCreatedAt"
      FROM leg_expenses e
      INNER JOIN travel_legs tl ON tl.id=e.leg_id
      LEFT JOIN leg_manager_access lma ON lma.leg_id=e.leg_id
      LEFT JOIN bookings b ON b.id=e.booking_id
      LEFT JOIN LATERAL (
        SELECT lr.* FROM leg_receipts lr WHERE lr.expense_id=e.id
        ORDER BY (lr.image_status='image_uploaded') DESC, lr.created_at DESC, lr.id DESC LIMIT 1
      ) r ON true
      ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
    `);
    return resultRows<any>(result).map(normalize).filter((row) => {
      if (filters.legId && row.legId !== filters.legId) return false;
      if (filters.bookingId && row.bookingId !== filters.bookingId) return false;
      if (filters.category && row.category !== filters.category) return false;
      if (filters.paymentSource && row.paymentSource !== filters.paymentSource) return false;
      if (filters.assignmentSource && row.assignmentSource !== filters.assignmentSource) return false;
      if (filters.dateFrom && row.occurredAt < filters.dateFrom) return false;
      if (filters.dateTo && row.occurredAt > filters.dateTo) return false;
      if (filters.receiptStatus === "attached" && row.receiptImageStatus !== "image_uploaded") return false;
      if (filters.receiptStatus === "missing" && row.receiptId !== null) return false;
      if (filters.receiptStatus === "incomplete" && (row.receiptId === null || row.receiptImageStatus === "image_uploaded")) return false;
      return true;
    });
  }

  async getAdminExpense(id: string): Promise<AdminExpenseRow | null> {
    return (await this.listAdminExpenses()).find((row) => row.id === id) ?? null;
  }

  async listExpenseAudit(id: string): Promise<FinanceAuditView[]> {
    const result = await this.database.execute(sql`
      SELECT id, actor_id AS "actorId", actor_label AS "actorLabel", change_reason AS "changeReason",
        previous_values AS "previousValues", new_values AS "newValues", changed_at AS "changedAt"
      FROM leg_finance_audit WHERE record_type='expense' AND record_id=${id}::uuid ORDER BY changed_at DESC, id DESC
    `);
    return resultRows<any>(result).map((row) => ({ id: String(row.id), actorId: row.actorId ?? null, actorLabel: String(row.actorLabel),
      changeReason: row.changeReason ?? null, previousValues: (row.previousValues ?? {}) as Record<string, unknown>,
      newValues: (row.newValues ?? {}) as Record<string, unknown>, changedAt: asDate(row.changedAt) }));
  }

  async updateAdminExpense(id: string, input: AdminExpenseUpdateInput, actor: FinanceAuditActor) {
    const before = await this.getAdminExpense(id);
    if (!before) return null;
    const has = (key: keyof AdminExpenseUpdateInput) => Object.prototype.hasOwnProperty.call(input, key);
    const assignmentChanged = has("bookingId") || has("tripId") || has("tripSegmentId");
    const nextRefs = {
      bookingId: has("bookingId") ? input.bookingId ?? null : before.bookingId,
      tripId: has("tripId") ? input.tripId ?? null : before.tripId,
      tripSegmentId: has("tripSegmentId") ? input.tripSegmentId ?? null : before.tripSegmentId,
    };
    if (assignmentChanged && !(await this.refsBelongToLeg(before.legId, nextRefs))) throw new Error("OUTSIDE_LEG");

    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    const sets: SQL[] = [];
    const add = (key: string, value: unknown, fragment: SQL) => { previousValues[key] = (before as any)[key] ?? null; newValues[key] = value ?? null; sets.push(fragment); };
    if (has("merchant")) add("merchant", input.merchant ?? null, sql`merchant=${input.merchant ?? null}`);
    if (has("category")) add("category", input.category, sql`category=${input.category}`);
    if (has("amountCents")) add("amountCents", input.amountCents, sql`amount_cents=${input.amountCents}`);
    if (has("taxCents")) add("taxCents", input.taxCents, sql`tax_cents=${input.taxCents}`);
    if (has("paymentSource")) add("paymentSource", input.paymentSource, sql`payment_source=${input.paymentSource}`);
    if (has("occurredAt")) add("occurredAt", input.occurredAt?.toISOString(), sql`occurred_at=${input.occurredAt}`);
    if (has("notes")) add("notes", input.notes ?? null, sql`notes=${input.notes ?? null}`);
    if (has("bookingId")) add("bookingId", input.bookingId ?? null, sql`booking_id=${input.bookingId ?? null}::uuid`);
    if (has("tripId")) add("tripId", input.tripId ?? null, sql`trip_id=${input.tripId ?? null}::uuid`);
    if (has("tripSegmentId")) add("tripSegmentId", input.tripSegmentId ?? null, sql`trip_segment_id=${input.tripSegmentId ?? null}::uuid`);
    if (!sets.length) return before;
    if (assignmentChanged) {
      previousValues.assignmentSource = before.assignmentSource; newValues.assignmentSource = "admin";
      sets.push(sql`assignment_source='admin'`, sql`assignment_reason=${input.changeReason?.trim() || "Admin reassignment"}`, sql`assignment_updated_at=now()`);
    }
    sets.push(sql`revision=revision+1`, sql`updated_at=now()`);
    await this.database.transaction(async (tx) => {
      await tx.execute(sql`UPDATE leg_expenses SET ${sql.join(sets, sql`, `)} WHERE id=${id}::uuid`);
      await tx.execute(sql`INSERT INTO leg_finance_audit (record_type,record_id,actor_id,actor_label,change_reason,previous_values,new_values)
        VALUES ('expense',${id}::uuid,${actor.actorId},${actor.actorLabel},${input.changeReason?.trim() || null},${JSON.stringify(previousValues)}::jsonb,${JSON.stringify(newValues)}::jsonb)`);
    });
    return this.getAdminExpense(id);
  }
}
