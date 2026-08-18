import { and, eq, sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  bookings,
  legCashEntries,
  legEventIncome,
  legExpenses,
  legMileageEntries,
  legReceipts,
  tripSegments,
  trips,
} from "@/db/schema";
import { calculateCashPosition, calculateSettlement } from "./finance-math";
import type { LegCashEntryKind } from "./finance-types";
import type {
  AdminExpenseFilters,
  AdminExpenseRow,
  AdminExpenseUpdateInput,
  FinanceAuditActor,
  FinanceAuditView,
  FinanceAssignmentSource,
} from "./admin-finance-types";

export type FinanceMutationKind = "income" | "expense" | "cash" | "mileage";
export type FinanceRefs = {
  bookingId: string | null;
  tripId: string | null;
  tripSegmentId: string | null;
};
export type FinanceMutationInput = FinanceRefs & {
  legId: string;
  clientMutationId: string;
  payload: Record<string, unknown>;
};

export interface FinanceMutationStore {
  findByMutation(
    legId: string,
    kind: FinanceMutationKind,
    clientMutationId: string,
  ): Promise<any | null>;
  refsBelongToLeg(legId: string, refs: FinanceRefs): Promise<boolean>;
  insert(kind: FinanceMutationKind, input: FinanceMutationInput): Promise<any>;
  ensureDerivedCash?(
    kind: FinanceMutationKind,
    input: FinanceMutationInput,
    row: any,
  ): Promise<void>;
}

function rows<T>(value: unknown): T[] {
  return ((value as { rows?: T[] }).rows ?? value ?? []) as T[];
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function nullableDate(value: unknown): Date | null {
  return value == null ? null : date(value);
}

function normalizeAdminExpenseRow(row: any): AdminExpenseRow {
  return {
    id: String(row.id),
    legId: String(row.legId),
    legName: String(row.legName),
    bookingId: row.bookingId ?? null,
    bookingName: row.bookingName ?? null,
    tripId: row.tripId ?? null,
    tripSegmentId: row.tripSegmentId ?? null,
    assignmentSource: String(row.assignmentSource ?? "unassigned") as FinanceAssignmentSource,
    assignmentReason: row.assignmentReason ?? null,
    assignmentUpdatedAt: nullableDate(row.assignmentUpdatedAt),
    merchant: row.merchant ?? null,
    category: String(row.category),
    amountCents: Number(row.amountCents),
    taxCents: Number(row.taxCents ?? 0),
    paymentSource: String(row.paymentSource),
    occurredAt: date(row.occurredAt),
    notes: row.notes ?? null,
    employeeNote: row.employeeNote ?? null,
    createdAt: date(row.createdAt),
    updatedAt: date(row.updatedAt),
    receiptId: row.receiptId ?? null,
    receiptObjectKey: row.receiptObjectKey ?? null,
    receiptImageStatus: row.receiptImageStatus ?? null,
    receiptMimeType: row.receiptMimeType ?? null,
    receiptCreatedAt: nullableDate(row.receiptCreatedAt),
  };
}

export function derivedCashEntryForMutation(
  kind: FinanceMutationKind,
  row: any,
): { kind: LegCashEntryKind; amountCents: number } | null {
  if (kind === "income" && Number(row.cashCents ?? 0) > 0) {
    return { kind: "event_cash_collected", amountCents: Number(row.cashCents) };
  }
  if (kind === "expense" && row.paymentSource === "adventure_zone_cash") {
    const amountCents = Number(row.amountCents ?? 0) + Number(row.taxCents ?? 0);
    if (amountCents > 0) return { kind: "expense_paid_cash", amountCents };
  }
  return null;
}

export async function createFinanceMutation(
  store: FinanceMutationStore,
  kind: FinanceMutationKind,
  input: FinanceMutationInput,
) {
  const existing = await store.findByMutation(
    input.legId,
    kind,
    input.clientMutationId,
  );
  if (existing) {
    await store.ensureDerivedCash?.(kind, input, existing);
    return { ok: true as const, idempotent: true, row: existing };
  }

  if (!(await store.refsBelongToLeg(input.legId, input))) {
    return { ok: false as const, error: "OUTSIDE_LEG" as const };
  }

  const row = await store.insert(kind, input);
  await store.ensureDerivedCash?.(kind, input, row);
  return { ok: true as const, idempotent: false, row };
}

export class DrizzleFinanceRepository implements FinanceMutationStore {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async findByMutation(
    legId: string,
    kind: FinanceMutationKind,
    clientMutationId: string,
  ) {
    switch (kind) {
      case "income":
        return (
          await this.database
            .select()
            .from(legEventIncome)
            .where(and(eq(legEventIncome.legId, legId), eq(legEventIncome.clientMutationId, clientMutationId)))
            .limit(1)
        )[0] ?? null;
      case "expense":
        return (
          await this.database
            .select()
            .from(legExpenses)
            .where(and(eq(legExpenses.legId, legId), eq(legExpenses.clientMutationId, clientMutationId)))
            .limit(1)
        )[0] ?? null;
      case "cash":
        return (
          await this.database
            .select()
            .from(legCashEntries)
            .where(and(eq(legCashEntries.legId, legId), eq(legCashEntries.clientMutationId, clientMutationId)))
            .limit(1)
        )[0] ?? null;
      case "mileage":
        return (
          await this.database
            .select()
            .from(legMileageEntries)
            .where(and(eq(legMileageEntries.legId, legId), eq(legMileageEntries.clientMutationId, clientMutationId)))
            .limit(1)
        )[0] ?? null;
    }
  }

  async refsBelongToLeg(legId: string, refs: FinanceRefs) {
    if (refs.bookingId) {
      const found = await this.database
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, refs.bookingId), eq(bookings.travelLegId, legId)))
        .limit(1);
      if (!found[0]) return false;
    }
    if (refs.tripId) {
      const found = await this.database
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, refs.tripId), eq(trips.travelLegId, legId)))
        .limit(1);
      if (!found[0]) return false;
    }
    if (refs.tripSegmentId) {
      const found = await this.database
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .innerJoin(trips, eq(trips.id, tripSegments.tripId))
        .where(and(eq(tripSegments.id, refs.tripSegmentId), eq(trips.travelLegId, legId)))
        .limit(1);
      if (!found[0]) return false;
    }
    return true;
  }

  private values(input: FinanceMutationInput) {
    return {
      legId: input.legId,
      bookingId: input.bookingId,
      tripId: input.tripId,
      tripSegmentId: input.tripSegmentId,
      clientMutationId: input.clientMutationId,
      ...input.payload,
    };
  }

  async insert(kind: FinanceMutationKind, input: FinanceMutationInput) {
    const values = this.values(input);
    let row: any | null = null;
    switch (kind) {
      case "income":
        row = (await this.database.insert(legEventIncome).values(values as any).onConflictDoNothing({ target: [legEventIncome.legId, legEventIncome.clientMutationId] }).returning())[0] ?? null;
        break;
      case "expense":
        row = (await this.database.insert(legExpenses).values(values as any).onConflictDoNothing({ target: [legExpenses.legId, legExpenses.clientMutationId] }).returning())[0] ?? null;
        break;
      case "cash":
        row = (await this.database.insert(legCashEntries).values(values as any).onConflictDoNothing({ target: [legCashEntries.legId, legCashEntries.clientMutationId] }).returning())[0] ?? null;
        break;
      case "mileage":
        row = (await this.database.insert(legMileageEntries).values(values as any).onConflictDoNothing({ target: [legMileageEntries.legId, legMileageEntries.clientMutationId] }).returning())[0] ?? null;
        break;
    }
    if (row) return row;
    const existing = await this.findByMutation(input.legId, kind, input.clientMutationId);
    if (!existing) throw new Error("Finance mutation insert conflict without existing row");
    return existing;
  }

  async ensureDerivedCash(
    kind: FinanceMutationKind,
    input: FinanceMutationInput,
    row: any,
  ) {
    const derived = derivedCashEntryForMutation(kind, row);
    if (!derived) return;
    await this.database
      .insert(legCashEntries)
      .values({
        legId: input.legId,
        bookingId: input.bookingId,
        tripId: input.tripId,
        tripSegmentId: input.tripSegmentId,
        kind: derived.kind,
        amountCents: derived.amountCents,
        occurredAt: row.occurredAt ?? new Date(),
        notes: kind === "income" ? "Automatically recorded from event cash income" : "Automatically recorded from cash-paid expense",
        clientMutationId: input.clientMutationId,
      })
      .onConflictDoNothing({ target: [legCashEntries.legId, legCashEntries.clientMutationId] });
  }

  async listAdminExpenses(filters: AdminExpenseFilters = {}): Promise<AdminExpenseRow[]> {
    const result = await this.database.execute(sql`
      SELECT
        e.id,
        e.leg_id AS "legId",
        tl.name AS "legName",
        e.booking_id AS "bookingId",
        b.name AS "bookingName",
        e.trip_id AS "tripId",
        e.trip_segment_id AS "tripSegmentId",
        COALESCE(e.assignment_source, 'unassigned') AS "assignmentSource",
        e.assignment_reason AS "assignmentReason",
        e.assignment_updated_at AS "assignmentUpdatedAt",
        e.merchant,
        e.category,
        e.amount_cents AS "amountCents",
        e.tax_cents AS "taxCents",
        e.payment_source AS "paymentSource",
        e.occurred_at AS "occurredAt",
        e.notes,
        e.employee_note AS "employeeNote",
        e.created_at AS "createdAt",
        e.updated_at AS "updatedAt",
        r.id AS "receiptId",
        r.object_key AS "receiptObjectKey",
        r.image_status AS "receiptImageStatus",
        r.mime_type AS "receiptMimeType",
        r.created_at AS "receiptCreatedAt"
      FROM leg_expenses e
      INNER JOIN travel_legs tl ON tl.id = e.leg_id
      LEFT JOIN bookings b ON b.id = e.booking_id
      LEFT JOIN LATERAL (
        SELECT lr.* FROM leg_receipts lr
        WHERE lr.expense_id = e.id
        ORDER BY lr.created_at DESC, lr.id DESC
        LIMIT 1
      ) r ON true
      ORDER BY e.occurred_at DESC, e.created_at DESC, e.id DESC
    `);

    return rows<any>(result)
      .map(normalizeAdminExpenseRow)
      .filter((row) => {
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
    const all = await this.listAdminExpenses();
    return all.find((row) => row.id === id) ?? null;
  }

  async listExpenseAudit(id: string): Promise<FinanceAuditView[]> {
    const result = await this.database.execute(sql`
      SELECT id, actor_id AS "actorId", actor_label AS "actorLabel",
        change_reason AS "changeReason", previous_values AS "previousValues",
        new_values AS "newValues", changed_at AS "changedAt"
      FROM leg_finance_audit
      WHERE record_type = 'expense' AND record_id = ${id}::uuid
      ORDER BY changed_at DESC, id DESC
    `);
    return rows<any>(result).map((row) => ({
      id: String(row.id),
      actorId: row.actorId ?? null,
      actorLabel: String(row.actorLabel),
      changeReason: row.changeReason ?? null,
      previousValues: (row.previousValues ?? {}) as Record<string, unknown>,
      newValues: (row.newValues ?? {}) as Record<string, unknown>,
      changedAt: date(row.changedAt),
    }));
  }

  async updateAdminExpense(
    id: string,
    input: AdminExpenseUpdateInput,
    actor: FinanceAuditActor,
  ): Promise<AdminExpenseRow | null> {
    const before = await this.getAdminExpense(id);
    if (!before) return null;

    const assignmentChanged =
      Object.prototype.hasOwnProperty.call(input, "bookingId") ||
      Object.prototype.hasOwnProperty.call(input, "tripId") ||
      Object.prototype.hasOwnProperty.call(input, "tripSegmentId");

    const nextRefs: FinanceRefs = {
      bookingId: Object.prototype.hasOwnProperty.call(input, "bookingId") ? input.bookingId ?? null : before.bookingId,
      tripId: Object.prototype.hasOwnProperty.call(input, "tripId") ? input.tripId ?? null : before.tripId,
      tripSegmentId: Object.prototype.hasOwnProperty.call(input, "tripSegmentId") ? input.tripSegmentId ?? null : before.tripSegmentId,
    };
    if (assignmentChanged && !(await this.refsBelongToLeg(before.legId, nextRefs))) {
      throw new Error("OUTSIDE_LEG");
    }

    const previousValues: Record<string, unknown> = {};
    const newValues: Record<string, unknown> = {};
    const sets: SQL[] = [];
    const add = (key: string, value: unknown, fragment: SQL) => {
      previousValues[key] = (before as any)[key] ?? null;
      newValues[key] = value ?? null;
      sets.push(fragment);
    };

    if (Object.prototype.hasOwnProperty.call(input, "merchant")) add("merchant", input.merchant ?? null, sql`merchant = ${input.merchant ?? null}`);
    if (Object.prototype.hasOwnProperty.call(input, "category")) add("category", input.category, sql`category = ${input.category}`);
    if (Object.prototype.hasOwnProperty.call(input, "amountCents")) add("amountCents", input.amountCents, sql`amount_cents = ${input.amountCents}`);
    if (Object.prototype.hasOwnProperty.call(input, "taxCents")) add("taxCents", input.taxCents, sql`tax_cents = ${input.taxCents}`);
    if (Object.prototype.hasOwnProperty.call(input, "paymentSource")) add("paymentSource", input.paymentSource, sql`payment_source = ${input.paymentSource}`);
    if (Object.prototype.hasOwnProperty.call(input, "occurredAt")) add("occurredAt", input.occurredAt?.toISOString(), sql`occurred_at = ${input.occurredAt}`);
    if (Object.prototype.hasOwnProperty.call(input, "notes")) add("notes", input.notes ?? null, sql`notes = ${input.notes ?? null}`);
    if (Object.prototype.hasOwnProperty.call(input, "bookingId")) add("bookingId", input.bookingId ?? null, sql`booking_id = ${input.bookingId ?? null}::uuid`);
    if (Object.prototype.hasOwnProperty.call(input, "tripId")) add("tripId", input.tripId ?? null, sql`trip_id = ${input.tripId ?? null}::uuid`);
    if (Object.prototype.hasOwnProperty.call(input, "tripSegmentId")) add("tripSegmentId", input.tripSegmentId ?? null, sql`trip_segment_id = ${input.tripSegmentId ?? null}::uuid`);

    if (!sets.length) return before;
    if (assignmentChanged) {
      previousValues.assignmentSource = before.assignmentSource;
      newValues.assignmentSource = "admin";
      sets.push(sql`assignment_source = 'admin'`);
      sets.push(sql`assignment_reason = ${input.changeReason?.trim() || "Admin reassignment"}`);
      sets.push(sql`assignment_updated_at = now()`);
    }
    sets.push(sql`revision = revision + 1`);
    sets.push(sql`updated_at = now()`);

    await this.database.transaction(async (tx) => {
      await tx.execute(sql`UPDATE leg_expenses SET ${sql.join(sets, sql`, `)} WHERE id = ${id}::uuid`);
      await tx.execute(sql`
        INSERT INTO leg_finance_audit (
          record_type, record_id, actor_id, actor_label, change_reason,
          previous_values, new_values
        ) VALUES (
          'expense', ${id}::uuid, ${actor.actorId}, ${actor.actorLabel},
          ${input.changeReason?.trim() || null},
          ${JSON.stringify(previousValues)}::jsonb,
          ${JSON.stringify(newValues)}::jsonb
        )
      `);
    });

    return this.getAdminExpense(id);
  }

  async summary(legId: string | null, tripId?: string | null) {
    const incomeWhere = and(legId ? eq(legEventIncome.legId, legId) : undefined, tripId ? eq(legEventIncome.tripId, tripId) : undefined);
    const expenseWhere = and(legId ? eq(legExpenses.legId, legId) : undefined, tripId ? eq(legExpenses.tripId, tripId) : undefined);
    const cashWhere = and(legId ? eq(legCashEntries.legId, legId) : undefined, tripId ? eq(legCashEntries.tripId, tripId) : undefined);
    const mileageWhere = and(legId ? eq(legMileageEntries.legId, legId) : undefined, tripId ? eq(legMileageEntries.tripId, tripId) : undefined);
    const receiptWhere = legId ? eq(legReceipts.legId, legId) : undefined;

    const [income, expenses, cash, mileage, receipts] = await Promise.all([
      this.database.select().from(legEventIncome).where(incomeWhere),
      this.database.select().from(legExpenses).where(expenseWhere),
      this.database.select().from(legCashEntries).where(cashWhere),
      this.database.select().from(legMileageEntries).where(mileageWhere),
      this.database.select().from(legReceipts).where(receiptWhere),
    ]);

    const incomeTotalCents = income.reduce((total, row) => total + row.cashCents + row.squareCents + row.otherCents, 0);
    const expenseTotalCents = expenses.reduce((total, row) => total + row.amountCents + row.taxCents, 0);
    const settlementEffects: Array<{ kind: any; amountCents: number }> = [];
    for (const expense of expenses) {
      const amountCents = expense.amountCents + expense.taxCents;
      if (expense.paymentSource === "personal") settlementEffects.push({ kind: "personal_expense", amountCents });
      else if (expense.paymentSource === "adventure_zone_debit") settlementEffects.push({ kind: "company_debit_expense", amountCents });
    }
    for (const entry of cash) settlementEffects.push({ kind: entry.kind as LegCashEntryKind, amountCents: entry.amountCents });
    const cashPositionEntries = cash.map((entry) => ({ kind: entry.kind as LegCashEntryKind, amountCents: entry.amountCents }));
    const receiptByExpense = new Map(receipts.map((receipt) => [receipt.expenseId, receipt.imageStatus]));
    const expensesWithReceipts = expenses.map((expense) => ({
      ...expense,
      receiptStatus: receiptByExpense.get(expense.id) ?? "missing",
    }));

    return {
      incomeTotalCents,
      expenseTotalCents,
      cashPosition: calculateCashPosition(cashPositionEntries),
      settlement: calculateSettlement(settlementEffects),
      missingReceiptCount: expensesWithReceipts.filter((expense) => expense.receiptStatus !== "image_uploaded").length,
      income,
      expenses: expensesWithReceipts,
      cash,
      mileage,
    };
  }
}
