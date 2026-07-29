import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createDrizzleTodayDashboardRepository,
  needsFollowUpPlanCondition,
  openFollowUpsCondition,
  TODAY_FOLLOW_UP_PAGE_SIZE,
  TODAY_PLAN_PAGE_SIZE,
  TODAY_UPCOMING_EVENT_LIMIT,
  upcomingEventsCondition,
} from "@/features/follow-ups/today-query";

const dialect = new PgDialect();

describe("Today bounded-query contract", () => {
  it("keeps the work queue on open follow-ups and bounded page sizes", () => {
    const query = dialect.sqlToQuery(openFollowUpsCondition());

    expect(query.sql).toContain('"follow_ups"."completed_at" is null');
    expect(TODAY_FOLLOW_UP_PAGE_SIZE).toBe(50);
    expect(TODAY_PLAN_PAGE_SIZE).toBe(25);
  });

  it("finds active bookings with a serialized future boundary in SQL", () => {
    const boundary = new Date("2026-08-04T05:00:00.000Z");
    const query = dialect.sqlToQuery(needsFollowUpPlanCondition(boundary)!);

    expect(query.sql.toLowerCase()).toContain("not exists");
    expect(query.sql).toContain('"follow_ups"."booking_id" = "bookings"."id"');
    expect(query.sql).toContain('"follow_ups"."completed_at" is null');
    expect(query.sql).toContain('"follow_ups"."due_at" >=');
    expect(query.params).toContain("2026-08-04T05:00:00.000Z");
  });

  it("windows upcoming bookings from Chicago start-of-day and limits the card", () => {
    const start = new Date("2026-08-03T05:00:00.000Z");
    const query = dialect.sqlToQuery(upcomingEventsCondition(start));

    expect(query.sql).toContain('"bookings"."starts_at" >=');
    expect(query.params).toEqual([start.toISOString()]);
    expect(TODAY_UPCOMING_EVENT_LIMIT).toBe(5);
  });

  it("serializes priority dates before applying stable pagination", async () => {
    const database = new QueryContractDatabase();
    const repository = createDrizzleTodayDashboardRepository(
      database as unknown as Parameters<
        typeof createDrizzleTodayDashboardRepository
      >[0],
    );

    await repository.listOpenFollowUps({
      page: 2,
      pageSize: TODAY_FOLLOW_UP_PAGE_SIZE,
      now: new Date("2026-08-03T14:00:00.000Z"),
    });

    expect(database.steps).toEqual(["orderBy", "limit", "offset"]);
    expect(database.orderSql.toLowerCase()).toContain("case");
    expect(database.orderSql).toContain('"follow_ups"."due_at"');
    expect(database.orderSql).toContain('"bookings"."status"');
    expect(database.orderSql).toContain('"bookings"."probability"');
    expect(database.orderSql).toContain('"bookings"."updated_at"');
    expect(database.orderSql).toMatch(
      /case[\s\S]*"follow_ups"\."due_at" < \$1 then 0[\s\S]*"follow_ups"\."due_at" < \$2 then 1[\s\S]*"bookings"\."status"[\s\S]*then 2[\s\S]*"bookings"\."probability" = \$7 then 3[\s\S]*"bookings"\."updated_at" <= \$8[\s\S]*then 4[\s\S]*else 5[\s\S]*end asc[\s\S]*"follow_ups"\."due_at" asc[\s\S]*"follow_ups"\."created_at" asc[\s\S]*"follow_ups"\."id" asc/i,
    );
    expect(database.priorityParams).toEqual([
      "2026-08-03T05:00:00.000Z",
      "2026-08-04T05:00:00.000Z",
      "pending_decision",
      "pending_contract",
      "contract_received",
      "%deadline%",
      "likely",
      "2026-07-20T14:00:00.000Z",
    ]);
  });

  it("uses the same priority CASE for the next call query", async () => {
    const database = new QueryContractDatabase();
    const repository = createDrizzleTodayDashboardRepository(
      database as unknown as Parameters<
        typeof createDrizzleTodayDashboardRepository
      >[0],
    );

    await repository.findNextCall(new Date("2026-08-03T14:00:00.000Z"));

    expect(database.steps).toEqual(["orderBy", "limit"]);
    expect(database.orderSql.toLowerCase()).toContain("case");
  });
});

class QueryContractDatabase {
  readonly steps: string[] = [];
  orderSql = "";
  priorityParams: unknown[] = [];

  select(selection?: Record<string, unknown>) {
    const isCount = Boolean(selection && "value" in selection);
    const recordOrder = (expressions: SQL[]) => {
      this.steps.push("orderBy");
      const queries = expressions.map((expression) =>
        dialect.sqlToQuery(expression),
      );
      this.orderSql = queries.map((query) => query.sql).join(" ");
      this.priorityParams = queries[0]?.params ?? [];
    };
    const recordStep = (step: string) => this.steps.push(step);
    const builder = {
      from() {
        return builder;
      },
      leftJoin() {
        return builder;
      },
      where() {
        return builder;
      },
      orderBy(...expressions: SQL[]) {
        recordOrder(expressions);
        return builder;
      },
      limit() {
        recordStep("limit");
        return builder;
      },
      offset() {
        recordStep("offset");
        return builder;
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return Promise.resolve(isCount ? [{ value: 100 }] : []).then(
          onfulfilled,
          onrejected,
        );
      },
    };
    return builder;
  }
}
