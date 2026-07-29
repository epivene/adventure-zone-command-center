import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
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

  it("finds active bookings with no future open action in SQL", () => {
    const boundary = new Date("2026-08-04T05:00:00.000Z");
    const query = dialect.sqlToQuery(needsFollowUpPlanCondition(boundary)!);

    expect(query.sql.toLowerCase()).toContain("not exists");
    expect(query.sql).toContain('"follow_ups"."booking_id" = "bookings"."id"');
    expect(query.sql).toContain('"follow_ups"."completed_at" is null');
    expect(query.sql).toContain('"follow_ups"."due_at" >=');
    expect(query.params).toContain(boundary);
  });

  it("windows upcoming bookings from Chicago start-of-day and limits the card", () => {
    const start = new Date("2026-08-03T05:00:00.000Z");
    const query = dialect.sqlToQuery(upcomingEventsCondition(start));

    expect(query.sql).toContain('"bookings"."starts_at" >=');
    expect(query.params).toEqual([start.toISOString()]);
    expect(TODAY_UPCOMING_EVENT_LIMIT).toBe(5);
  });
});
