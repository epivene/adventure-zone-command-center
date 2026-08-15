import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  bookings,
  legCashEntries,
  legEventIncome,
  legExpenses,
  legMileageEntries,
  tripSegments,
  trips,
} from "@/db/schema";
import { calculateCashPosition, calculateSettlement } from "./finance-math";
import type { LegCashEntryKind } from "./finance-types";

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
  if (existing) return { ok: true as const, idempotent: true, row: existing };

  if (!(await store.refsBelongToLeg(input.legId, input))) {
    return { ok: false as const, error: "OUTSIDE_LEG" as const };
  }

  return {
    ok: true as const,
    idempotent: false,
    row: await store.insert(kind, input),
  };
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
            .where(
              and(
                eq(legEventIncome.legId, legId),
                eq(legEventIncome.clientMutationId, clientMutationId),
              ),
            )
            .limit(1)
        )[0] ?? null;
      case "expense":
        return (
          await this.database
            .select()
            .from(legExpenses)
            .where(
              and(
                eq(legExpenses.legId, legId),
                eq(legExpenses.clientMutationId, clientMutationId),
              ),
            )
            .limit(1)
        )[0] ?? null;
      case "cash":
        return (
          await this.database
            .select()
            .from(legCashEntries)
            .where(
              and(
                eq(legCashEntries.legId, legId),
                eq(legCashEntries.clientMutationId, clientMutationId),
              ),
            )
            .limit(1)
        )[0] ?? null;
      case "mileage":
        return (
          await this.database
            .select()
            .from(legMileageEntries)
            .where(
              and(
                eq(legMileageEntries.legId, legId),
                eq(legMileageEntries.clientMutationId, clientMutationId),
              ),
            )
            .limit(1)
        )[0] ?? null;
    }
  }

  async refsBelongToLeg(legId: string, refs: FinanceRefs) {
    if (refs.bookingId) {
      const rows = await this.database
        .select({ id: bookings.id })
        .from(bookings)
        .where(and(eq(bookings.id, refs.bookingId), eq(bookings.travelLegId, legId)))
        .limit(1);
      if (!rows[0]) return false;
    }

    if (refs.tripId) {
      const rows = await this.database
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, refs.tripId), eq(trips.travelLegId, legId)))
        .limit(1);
      if (!rows[0]) return false;
    }

    if (refs.tripSegmentId) {
      const rows = await this.database
        .select({ id: tripSegments.id })
        .from(tripSegments)
        .innerJoin(trips, eq(trips.id, tripSegments.tripId))
        .where(
          and(
            eq(tripSegments.id, refs.tripSegmentId),
            eq(trips.travelLegId, legId),
          ),
        )
        .limit(1);
      if (!rows[0]) return false;
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
        row = (
          await this.database
            .insert(legEventIncome)
            .values(values as any)
            .onConflictDoNothing({
              target: [legEventIncome.legId, legEventIncome.clientMutationId],
            })
            .returning()
        )[0] ?? null;
        break;
      case "expense":
        row = (
          await this.database
            .insert(legExpenses)
            .values(values as any)
            .onConflictDoNothing({
              target: [legExpenses.legId, legExpenses.clientMutationId],
            })
            .returning()
        )[0] ?? null;
        break;
      case "cash":
        row = (
          await this.database
            .insert(legCashEntries)
            .values(values as any)
            .onConflictDoNothing({
              target: [legCashEntries.legId, legCashEntries.clientMutationId],
            })
            .returning()
        )[0] ?? null;
        break;
      case "mileage":
        row = (
          await this.database
            .insert(legMileageEntries)
            .values(values as any)
            .onConflictDoNothing({
              target: [legMileageEntries.legId, legMileageEntries.clientMutationId],
            })
            .returning()
        )[0] ?? null;
        break;
    }

    if (row) return row;

    const existing = await this.findByMutation(
      input.legId,
      kind,
      input.clientMutationId,
    );
    if (!existing) {
      throw new Error("Finance mutation insert conflict without existing row");
    }
    return existing;
  }

  async summary(legId: string | null, tripId?: string | null) {
    const incomeWhere = and(
      legId ? eq(legEventIncome.legId, legId) : undefined,
      tripId ? eq(legEventIncome.tripId, tripId) : undefined,
    );
    const expenseWhere = and(
      legId ? eq(legExpenses.legId, legId) : undefined,
      tripId ? eq(legExpenses.tripId, tripId) : undefined,
    );
    const cashWhere = and(
      legId ? eq(legCashEntries.legId, legId) : undefined,
      tripId ? eq(legCashEntries.tripId, tripId) : undefined,
    );
    const mileageWhere = and(
      legId ? eq(legMileageEntries.legId, legId) : undefined,
      tripId ? eq(legMileageEntries.tripId, tripId) : undefined,
    );

    const [income, expenses, cash, mileage] = await Promise.all([
      this.database.select().from(legEventIncome).where(incomeWhere),
      this.database.select().from(legExpenses).where(expenseWhere),
      this.database.select().from(legCashEntries).where(cashWhere),
      this.database.select().from(legMileageEntries).where(mileageWhere),
    ]);

    const incomeTotalCents = income.reduce(
      (total, row) => total + row.cashCents + row.squareCents + row.otherCents,
      0,
    );
    const expenseTotalCents = expenses.reduce(
      (total, row) => total + row.amountCents + row.taxCents,
      0,
    );

    const settlementEffects: Array<{ kind: any; amountCents: number }> = [];
    for (const expense of expenses) {
      const amountCents = expense.amountCents + expense.taxCents;
      if (expense.paymentSource === "personal") {
        settlementEffects.push({ kind: "personal_expense", amountCents });
      } else if (expense.paymentSource === "adventure_zone_debit") {
        settlementEffects.push({ kind: "company_debit_expense", amountCents });
      }
    }
    for (const entry of cash) {
      settlementEffects.push({ kind: entry.kind as LegCashEntryKind, amountCents: entry.amountCents });
    }

    const cashPositionEntries = cash.map((entry) => ({
      kind: entry.kind as LegCashEntryKind,
      amountCents: entry.amountCents,
    }));

    return {
      incomeTotalCents,
      expenseTotalCents,
      cashPosition: calculateCashPosition(cashPositionEntries),
      settlement: calculateSettlement(settlementEffects),
      income,
      expenses,
      cash,
      mileage,
    };
  }
}
