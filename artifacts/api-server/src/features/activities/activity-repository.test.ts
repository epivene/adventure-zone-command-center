import { describe, expect, it } from "vitest";

import { DrizzleActivityRepository } from "./activity-repository";

type TimelineRow = {
  activity: Record<string, unknown> & {
    id: string;
    occurredAt: Date | null;
    timelineSortAt: Date;
  };
  revisionCount: number;
};

function orderedColumn(expression: unknown) {
  const chunks = (expression as { queryChunks?: unknown[] }).queryChunks ?? [];
  const column = chunks.find(
    (chunk): chunk is { name: string } =>
      typeof chunk === "object" && chunk !== null && "name" in chunk,
  );
  return column?.name;
}

function databaseWithPostgresNullOrdering(rows: TimelineRow[]) {
  let firstOrderColumn: string | undefined;
  const query = {
    from() { return this; },
    leftJoin() { return this; },
    where() { return this; },
    groupBy() { return this; },
    orderBy(first: unknown) {
      firstOrderColumn = orderedColumn(first);
      return this;
    },
    limit(limit: number) {
      this.limitValue = limit;
      return this;
    },
    limitValue: Number.POSITIVE_INFINITY,
    offset(offsetValue: number) {
      const value = (row: TimelineRow) =>
        firstOrderColumn === "timeline_sort_at"
          ? row.activity.timelineSortAt
          : row.activity.occurredAt;
      return Promise.resolve([...rows].sort((left, right) => {
        const leftValue = value(left);
        const rightValue = value(right);
        if (leftValue === null) return rightValue === null ? 0 : -1;
        if (rightValue === null) return 1;
        return rightValue.getTime() - leftValue.getTime();
      }).slice(offsetValue, offsetValue + this.limitValue));
    },
  };
  return { select: () => query };
}

function row(id: string, occurredAt: Date | null, timelineSortAt: Date): TimelineRow {
  return {
    activity: {
      id,
      organizationId: "10000000-0000-4000-8000-000000000001",
      contactId: null,
      bookingId: null,
      kind: occurredAt ? "call" : "act_history",
      subject: null,
      status: null,
      body: id,
      occurredAt,
      timelineSortAt,
      dateIsImportFallback: occurredAt === null,
      endsAt: null,
      actRecordId: occurredAt ? null : id,
      sourceRecordId: occurredAt ? null : "90000000-0000-4000-8000-000000000001",
      sourceVersionId: occurredAt ? null : "90000000-0000-4000-8000-000000000002",
      sourceType: occurredAt ? null : "history",
      createdAt: timelineSortAt,
      updatedAt: timelineSortAt,
    },
    revisionCount: 0,
  };
}

describe("DrizzleActivityRepository timeline ordering", () => {
  it("keeps a newer dated call visible beyond ten undated imported activities", async () => {
    const imported = Array.from({ length: 11 }, (_, index) =>
      row(
        `imported-${index}`,
        null,
        new Date(`2026-01-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`),
      ),
    );
    const newerCall = row(
      "newer-call",
      new Date("2026-08-13T16:00:00.000Z"),
      new Date("2026-08-13T16:00:00.000Z"),
    );
    const repository = new DrizzleActivityRepository(
      databaseWithPostgresNullOrdering([...imported, newerCall]) as never,
    );

    const timeline = await repository.listTimeline({
      organizationId: "10000000-0000-4000-8000-000000000001",
    });

    expect(timeline.items).toHaveLength(12);
    expect(timeline.nextPage).toBeNull();
    expect(timeline.items[0]).toMatchObject({ id: "newer-call" });
  });
});
