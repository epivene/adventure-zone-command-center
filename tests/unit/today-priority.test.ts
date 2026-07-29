import { describe, expect, it } from "vitest";

import {
  createDrizzleTodayDashboardRepository,
  selectFutureIncompleteFollowUp,
  sortFollowUpsForToday,
  type FollowUpSummary,
  type TodayDashboardFollowUpRow,
} from "@/features/follow-ups/today-query";
import { needsFollowUpPlan } from "@/features/follow-ups/follow-up-policy";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

function item(
  id: string,
  dueAt: string,
  status: FollowUpSummary["status"],
  overrides: Partial<FollowUpSummary> = {},
): FollowUpSummary {
  return {
    id,
    organizationId: null,
    contactId: null,
    bookingId: `booking-${id}`,
    bookingName: `Booking ${id}`,
    kind: "call",
    dueAt: new Date(dueAt),
    createdAt: new Date("2026-08-01T12:00:00Z"),
    status,
    probability: "possible",
    ...overrides,
  };
}

describe("sortFollowUpsForToday", () => {
  it("uses Chicago dates when separating overdue, due-today, and future work", () => {
    const result = sortFollowUpsForToday(
      [
        item("future", "2026-08-04T17:00:00Z", "due"),
        item("today", "2026-08-03T17:00:00Z", "due"),
        item("overdue", "2026-08-02T17:00:00Z", "due"),
      ],
      new Date("2026-08-04T04:30:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "overdue",
      "today",
      "future",
    ]);
  });

  it("orders overdue calls before calls due today and quiet leads", () => {
    const result = sortFollowUpsForToday(
      [
        item("quiet", "2026-08-10T15:00:00Z", "quiet_lead"),
        item("today", "2026-08-03T17:00:00Z", "due"),
        item("overdue", "2026-08-02T17:00:00Z", "due"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual(["overdue", "today", "quiet"]);
  });

  it("uses each explicit bucket, then due date and creation time", () => {
    const result = sortFollowUpsForToday(
      [
        item("other", "2026-08-04T18:00:00Z", "other"),
        item("quiet", "2026-08-04T18:00:00Z", "quiet_lead"),
        item("likely", "2026-08-04T18:00:00Z", "due", { probability: "likely" }),
        item("deadline", "2026-08-04T18:00:00Z", "deadline"),
        item("today-later", "2026-08-03T18:00:00Z", "due"),
        item("today-earlier-created", "2026-08-03T18:00:00Z", "due", {
          createdAt: new Date("2026-07-31T12:00:00Z"),
        }),
        item("overdue", "2026-08-02T18:00:00Z", "due"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "overdue",
      "today-earlier-created",
      "today-later",
      "deadline",
      "likely",
      "quiet",
      "other",
    ]);
  });

  it("orders same-day follow-ups by their stored instant within the today bucket", () => {
    const result = sortFollowUpsForToday(
      [
        item("today", "2026-08-03T15:00:00Z", "due"),
        item("late", "2026-08-03T13:59:59Z", "due"),
        item("future-deadline", "2026-08-04T13:00:00Z", "deadline"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "late",
      "today",
      "future-deadline",
    ]);
  });

  it("keeps an earlier same-day follow-up ahead of a later one", () => {
    const result = sortFollowUpsForToday(
      [
        item("later-today", "2026-08-03T15:00:00Z", "due"),
        item("earlier-today", "2026-08-03T13:59:59Z", "due"),
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result.map((entry) => entry.id)).toEqual([
      "earlier-today",
      "later-today",
    ]);
  });

  it("puts a later deadline on page one ahead of more than one page of earlier low-priority work", async () => {
    const now = new Date("2026-08-03T14:00:00.000Z");
    const lowPriorityRows = Array.from({ length: 50 }, (_, index) =>
      followUpRow(
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        new Date(`2026-08-04T${String(index % 24).padStart(2, "0")}:00:00.000Z`),
        "email",
      ),
    );
    const deadline = followUpRow(
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      new Date("2026-08-10T18:00:00.000Z"),
      "contract_deadline",
    );
    const database = new PriorityRecordingDatabase([...lowPriorityRows, deadline]);
    const repository = createDrizzleTodayDashboardRepository(
      database as unknown as Parameters<
        typeof createDrizzleTodayDashboardRepository
      >[0],
    );

    const result = await repository.listOpenFollowUps({
      page: 1,
      pageSize: 50,
      now,
    });

    expect(result.records).toHaveLength(50);
    expect(result.records.map((row) => row.followUp.id)).toContain(
      deadline.followUp.id,
    );
  });
});

describe("selectFutureIncompleteFollowUp", () => {
  it("keeps a booking planned when it has both overdue and future open follow-ups", () => {
    const result = selectFutureIncompleteFollowUp(
      [
        {
          id: "overdue",
          dueAt: new Date("2026-08-03T13:00:00Z"),
          completedAt: null,
        },
        {
          id: "future",
          dueAt: new Date("2026-08-06T15:00:00Z"),
          completedAt: null,
        },
      ],
      new Date("2026-08-03T14:00:00Z"),
    );

    expect(result?.id).toBe("future");
    expect(
      needsFollowUpPlan(
        { status: "interested" },
        result,
        new Date("2026-08-03T14:00:00Z"),
      ),
    ).toBe(false);
  });
});

function followUpRow(
  id: string,
  dueAt: Date,
  kind: string,
): TodayDashboardFollowUpRow {
  return {
    booking: {
      id: `booking-${id}`,
      organizationId: null,
      primaryContactId: null,
      name: `Booking ${id}`,
      city: "Fargo",
      region: "ND",
      startsAt: null,
      status: "possible",
      probability: "possible",
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
      updatedAt: new Date("2026-08-03T12:00:00.000Z"),
    },
    contact: null,
    followUp: {
      id,
      organizationId: null,
      contactId: null,
      bookingId: `booking-${id}`,
      kind,
      dueAt,
      completedAt: null,
      createdAt: new Date("2026-08-01T12:00:00.000Z"),
    },
    organization: null,
  };
}

class PriorityRecordingDatabase {
  private readonly dialect = new PgDialect();

  constructor(private readonly rows: TodayDashboardFollowUpRow[]) {}

  select(selection?: Record<string, unknown>) {
    const isCount = Boolean(selection && "value" in selection);
    let limit = Number.POSITIVE_INFINITY;
    let offset = 0;
    let orderSql = "";
    const rows = this.rows;
    const renderOrder = (expressions: SQL[]) =>
      expressions
        .map((expression) => this.dialect.sqlToQuery(expression).sql)
        .join(" ");
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
        orderSql = renderOrder(expressions);
        return builder;
      },
      limit(value: number) {
        limit = value;
        return builder;
      },
      offset(value: number) {
        offset = value;
        return builder;
      },
      then<TResult1 = unknown, TResult2 = never>(
        onfulfilled?: ((value: unknown) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        const records = isCount
          ? [{ value: rows.length }]
          : [...rows]
              .sort((left, right) => {
                if (orderSql.toLowerCase().includes("case")) {
                  const leftDeadline = left.followUp.kind.includes("deadline");
                  const rightDeadline = right.followUp.kind.includes("deadline");
                  if (leftDeadline !== rightDeadline) return leftDeadline ? -1 : 1;
                }
                return (
                  left.followUp.dueAt.getTime() - right.followUp.dueAt.getTime() ||
                  left.followUp.createdAt.getTime() -
                    right.followUp.createdAt.getTime() ||
                  left.followUp.id.localeCompare(right.followUp.id)
                );
              })
              .slice(offset, offset + limit);
        return Promise.resolve(records).then(onfulfilled, onrejected);
      },
    };
    return builder;
  }
}
