import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { allocateTripMiles, calculateEventWrapUp, type EventWrapUpCalculation } from "./event-wrap-up-calculation";
import type { EventWrapUp, EventWrapUpSource, EventWrapUpStore } from "./event-wrap-up-service";

type DrizzleDatabase = typeof database;
function rows<T>(value: unknown): T[] { return ((value as { rows?: T[] }).rows ?? []) as T[]; }
function num(value: unknown): number { return value == null ? 0 : Number(value); }
function nullableNum(value: unknown): number | null { return value == null ? null : Number(value); }

export type EventWrapUpPayload = {
  event: {
    bookingId: string;
    name: string;
    city: string;
    region: string;
    startsAt: string | null;
    endsAt: string | null;
    legId: string;
    legName: string;
    tripId: string | null;
    tripName: string | null;
  };
  wrapUp: EventWrapUp | null;
  calculation: EventWrapUpCalculation;
  finance: {
    cashCents: number;
    squareCents: number;
    otherCents: number;
    totalRevenueCents: number;
    directExpenses: Array<{
      id: string;
      category: string;
      merchant: string | null;
      amountCents: number;
      paymentSource: string;
      receiptStatus: string;
      countsAsAllocatedTravel: boolean;
    }>;
    missingReceiptCount: number;
  };
  travel: {
    tripMiles: number | null;
    automaticMiles: number;
    appliedMiles: number;
    mpg: number | null;
    fuelPricePerGallon: number | null;
    automaticSharePercent: number | null;
  };
  adjustments: Awaited<ReturnType<EventWrapUpStore["listAdjustments"]>>;
  overhead: Awaited<ReturnType<EventWrapUpStore["getOverhead"]>>;
  warnings: string[];
  sourceDataChanged?: boolean;
};

export class DrizzleEventWrapUpSource implements EventWrapUpSource {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly store: EventWrapUpStore,
  ) {}

  async bookingContext(bookingId: string) {
    const result = await this.database.execute(sql`
      select b.id as "bookingId", b.travel_leg_id as "legId",
        ts.trip_id as "tripId", efm.family_id as "familyId"
      from bookings b
      left join trip_stops ts on ts.booking_id=b.id
      left join event_family_members efm on efm.organization_id=b.organization_id
      where b.id=${bookingId}::uuid
      order by ts.sort_order asc nulls last
      limit 1
    `);
    const row = rows<any>(result)[0];
    return row ? {
      bookingId: row.bookingId,
      legId: row.legId ?? null,
      tripId: row.tripId ?? null,
      familyId: row.familyId ?? null,
    } : null;
  }

  async sourceFingerprint(bookingId: string) {
    const result = await this.database.execute(sql`
      select kind, id::text as id, updated_at::text as updated_at from (
        select 'booking' as kind, id, updated_at from bookings where id=${bookingId}::uuid
        union all
        select 'income', id, updated_at from leg_event_income where booking_id=${bookingId}::uuid
        union all
        select 'expense', id, updated_at from leg_expenses where booking_id=${bookingId}::uuid
        union all
        select 'receipt', r.id, r.updated_at from leg_receipts r
          inner join leg_expenses e on e.id=r.expense_id where e.booking_id=${bookingId}::uuid
        union all
        select 'trip', t.id, t.updated_at from trips t
          inner join trip_stops s on s.trip_id=t.id where s.booking_id=${bookingId}::uuid
        union all
        select 'segment', sg.id, sg.updated_at from trip_segments sg
          inner join trip_stops s on s.trip_id=sg.trip_id where s.booking_id=${bookingId}::uuid
      ) source_rows
      order by kind, id
    `);
    return createHash("sha256").update(JSON.stringify(rows<any>(result))).digest("hex");
  }

  async automaticMiles(bookingId: string, tripId: string) {
    const [stopResult, segmentResult] = await Promise.all([
      this.database.execute(sql`
        select id, booking_id as "bookingId", sort_order as "sortOrder"
        from trip_stops where trip_id=${tripId}::uuid order by sort_order asc, id asc
      `),
      this.database.execute(sql`
        select sequence, coalesce(override_miles, miles) as miles
        from trip_segments where trip_id=${tripId}::uuid order by sequence asc
      `),
    ]);
    const stops = rows<any>(stopResult);
    const index = stops.findIndex((stop) => stop.bookingId === bookingId);
    if (index < 0) return 0;
    const allocations = allocateTripMiles({
      segmentMiles: rows<any>(segmentResult).map((segment) => num(segment.miles)),
      stopCount: stops.length,
    });
    return allocations[index] ?? 0;
  }

  async buildPayload(bookingId: string, wrapUp: EventWrapUp | null): Promise<EventWrapUpPayload> {
    const context = await this.bookingContext(bookingId);
    if (!context?.legId) throw new Error("Event has no travel leg");

    const [eventResult, incomeResult, expenseResult, receiptResult, tripResult, segmentResult, fuelResult] = await Promise.all([
      this.database.execute(sql`
        select b.id as "bookingId", b.name, b.city, b.region,
          b.starts_at as "startsAt", b.ends_at as "endsAt",
          tl.id as "legId", tl.name as "legName",
          t.id as "tripId", t.name as "tripName"
        from bookings b
        inner join travel_legs tl on tl.id=b.travel_leg_id
        left join trip_stops s on s.booking_id=b.id
        left join trips t on t.id=s.trip_id
        where b.id=${bookingId}::uuid
        order by s.sort_order asc nulls last limit 1
      `),
      this.database.execute(sql`select * from leg_event_income where booking_id=${bookingId}::uuid order by occurred_at asc`),
      this.database.execute(sql`select * from leg_expenses where booking_id=${bookingId}::uuid order by occurred_at asc`),
      this.database.execute(sql`
        select r.expense_id as "expenseId", r.image_status as "imageStatus"
        from leg_receipts r inner join leg_expenses e on e.id=r.expense_id
        where e.booking_id=${bookingId}::uuid
      `),
      context.tripId ? this.database.execute(sql`
        select id, name, mpg, fuel_price_per_gallon as "fuelPricePerGallon"
        from trips where id=${context.tripId}::uuid limit 1
      `) : Promise.resolve({ rows: [] }),
      context.tripId ? this.database.execute(sql`
        select sequence, coalesce(override_miles, miles) as miles
        from trip_segments where trip_id=${context.tripId}::uuid order by sequence asc
      `) : Promise.resolve({ rows: [] }),
      this.database.execute(sql`
        select price_per_gallon as "pricePerGallon" from manager_fuel_price_observations
        where leg_id=${context.legId}::uuid order by observed_at desc limit 1
      `).catch(() => ({ rows: [] })),
    ]);

    const event = rows<any>(eventResult)[0];
    if (!event) throw new Error("Event could not be found");
    const income = rows<any>(incomeResult);
    const expenses = rows<any>(expenseResult);
    const receiptByExpense = new Map(rows<any>(receiptResult).map((row) => [row.expenseId, row.imageStatus]));
    const trip = rows<any>(tripResult)[0] ?? null;
    const segmentMiles = rows<any>(segmentResult).map((segment) => num(segment.miles));
    const tripMiles = segmentMiles.length ? segmentMiles.reduce((sum, miles) => sum + miles, 0) : null;
    const automaticMiles = context.tripId ? await this.automaticMiles(bookingId, context.tripId) : 0;
    const travelOverride = context.tripId ? await this.store.getTravelOverride(bookingId, context.tripId) : null;
    const overhead = await this.store.getOverhead(bookingId);
    const adjustments = await this.store.listAdjustments(bookingId);

    const cashCents = income.reduce((sum, row) => sum + num(row.cashCents ?? row.cash_cents), 0);
    const squareCents = income.reduce((sum, row) => sum + num(row.squareCents ?? row.square_cents), 0);
    const otherCents = income.reduce((sum, row) => sum + num(row.otherCents ?? row.other_cents), 0);
    const directExpenses = expenses.map((row) => {
      const category = String(row.category);
      return {
        id: String(row.id),
        category,
        merchant: row.merchant ?? null,
        amountCents: num(row.amountCents ?? row.amount_cents) + num(row.taxCents ?? row.tax_cents),
        paymentSource: String(row.paymentSource ?? row.payment_source),
        receiptStatus: String(receiptByExpense.get(row.id) ?? "missing"),
        countsAsAllocatedTravel: category === "fuel",
      };
    });
    const bookingFuelCost = directExpenses
      .filter((expense) => expense.countsAsAllocatedTravel)
      .reduce((sum, expense) => sum + expense.amountCents, 0);
    const latestFuel = rows<any>(fuelResult)[0];
    const mpg = nullableNum(trip?.mpg);
    const fuelPricePerGallon = nullableNum(trip?.fuelPricePerGallon) ?? nullableNum(latestFuel?.pricePerGallon);
    const directAdjustmentsCents = adjustments.filter((row) => row.scope === "direct").reduce((sum, row) => sum + row.amountCents, 0);
    const trueProfitAdjustmentsCents = adjustments.filter((row) => row.scope === "true_profit").reduce((sum, row) => sum + row.amountCents, 0);

    const calculation = calculateEventWrapUp({
      revenue: { cashCents, nonCashCents: squareCents, otherCashCents: otherCents },
      directExpenses: directExpenses.map((expense) => ({
        id: expense.id,
        amountCents: expense.amountCents,
        paymentSource: expense.paymentSource,
        countsAsAllocatedTravel: expense.countsAsAllocatedTravel,
      })),
      travel: {
        tripMiles,
        allocatedMiles: automaticMiles,
        mpg,
        fuelPricePerGallon,
        actualAllocatedFuelCostCents: bookingFuelCost > 0 ? bookingFuelCost : null,
        overrideMiles: travelOverride?.overrideMiles ?? null,
        overrideCostCents: travelOverride?.overrideCostCents ?? null,
      },
      actualCashOnHandCents: wrapUp?.actualCashOnHandCents ?? null,
      directAdjustmentsCents,
      crewWagesCents: null,
      overheadCents: overhead?.amountCents ?? null,
      trueProfitAdjustmentsCents,
    });

    const missingReceiptCount = directExpenses.filter((expense) => expense.receiptStatus !== "image_uploaded").length;
    const warnings: string[] = [];
    if (missingReceiptCount) warnings.push(`${missingReceiptCount} expense receipt${missingReceiptCount === 1 ? " is" : "s are"} missing or incomplete`);
    if (calculation.trueProfit.incompleteReasons.length) warnings.push(...calculation.trueProfit.incompleteReasons);

    return {
      event: {
        bookingId: event.bookingId,
        name: event.name,
        city: event.city,
        region: event.region,
        startsAt: event.startsAt ? new Date(event.startsAt).toISOString() : null,
        endsAt: event.endsAt ? new Date(event.endsAt).toISOString() : null,
        legId: event.legId,
        legName: event.legName,
        tripId: event.tripId ?? null,
        tripName: event.tripName ?? null,
      },
      wrapUp,
      calculation,
      finance: {
        cashCents,
        squareCents,
        otherCents,
        totalRevenueCents: cashCents + squareCents + otherCents,
        directExpenses,
        missingReceiptCount,
      },
      travel: {
        tripMiles,
        automaticMiles,
        appliedMiles: calculation.travel.appliedMiles,
        mpg,
        fuelPricePerGallon,
        automaticSharePercent: tripMiles && tripMiles > 0 ? (automaticMiles / tripMiles) * 100 : null,
      },
      adjustments,
      overhead,
      warnings,
    };
  }
}
