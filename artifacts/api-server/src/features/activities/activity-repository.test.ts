import { describe, expect, it } from "vitest";

import {
  activities,
  activityRevisions,
  auditEntries,
  bookingContacts,
  bookings,
  callSessions,
  contacts,
  followUps,
  organizationContacts,
} from "@/db/schema";

import { DrizzleActivityRepository } from "./activity-repository";

type TimelineRow = {
  activity: Record<string, unknown> & {
    id: string;
    occurredAt: Date | null;
    timelineSortAt: Date;
  };
  revisionCount: number;
};

type CallSessionRow = {
  id: string;
  noteActivityId: string;
  disposition: "left_voicemail" | "spoke_with_contact";
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

function isColumnPair(
  predicate: unknown,
  leftColumn: unknown,
  rightColumn: unknown,
) {
  if (
    typeof predicate === "object" &&
    predicate !== null &&
    "kind" in predicate &&
    (predicate as { kind: unknown }).kind === "eq"
  ) {
    const eqPredicate = predicate as unknown as { left: unknown; right: unknown };
    return (
      (eqPredicate.left === leftColumn && eqPredicate.right === rightColumn) ||
      (eqPredicate.left === rightColumn && eqPredicate.right === leftColumn)
    );
  }
  const chunks = (predicate as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.includes(leftColumn) && chunks.includes(rightColumn);
}

function databaseWithLinkedCallSessions(
  rows: TimelineRow[],
  linkedCallSessions: CallSessionRow[],
) {
  let firstOrderColumn: string | undefined;
  let hasCallSessionNoteActivityJoin = false;
  const query = {
    from() { return this; },
    leftJoin(table: unknown, predicate: unknown) {
      if (
        table === callSessions &&
        isColumnPair(predicate, callSessions.noteActivityId, activities.id)
      ) {
        hasCallSessionNoteActivityJoin = true;
      }
      return this;
    },
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
      }).slice(offsetValue, offsetValue + this.limitValue).map((row) => {
        const linkedCallSession = hasCallSessionNoteActivityJoin
          ? linkedCallSessions.find((session) => session.noteActivityId === row.activity.id)
          : undefined;
        return {
          ...row,
          callSessionDisposition: linkedCallSession?.disposition ?? null,
        };
      }));
    },
  };
  return { select: () => query };
}

function databaseWithEditableLinkedCall(
  initialActivity: TimelineRow["activity"],
  linkedCallSession: CallSessionRow | null,
) {
  const revisions: unknown[] = [];
  const insertedTables: unknown[] = [];
  const updatedTables: unknown[] = [];
  let activity = initialActivity;
  let callSession = linkedCallSession;
  function select(selection?: Record<string, unknown>) {
    let selectedTable: unknown;
    let hasCallSessionNoteActivityJoin = false;
    const query = {
      from(table: unknown) {
        selectedTable = table;
        return this;
      },
      leftJoin(table: unknown, predicate: unknown) {
        if (
          table === callSessions &&
          isColumnPair(predicate, callSessions.noteActivityId, activities.id)
        ) {
          hasCallSessionNoteActivityJoin = true;
        }
        return this;
      },
      where() { return this; },
      groupBy() { return this; },
      orderBy() { return this; },
      limit() { return this; },
      for() {
        if (selectedTable === callSessions) {
          return Promise.resolve(
            callSession?.noteActivityId === activity.id ? [callSession] : [],
          );
        }
        return Promise.resolve([activity]);
      },
      then(resolve: (value: unknown[]) => unknown) {
        if (selectedTable === activityRevisions) {
          return Promise.resolve([{ value: revisions.length }]).then(resolve);
        }
        if (selection && "callSessionDisposition" in selection) {
          return Promise.resolve([
            {
              activity,
              revisionCount: revisions.length,
              callSessionDisposition:
                hasCallSessionNoteActivityJoin &&
                callSession?.noteActivityId === activity.id
                  ? callSession.disposition
                  : null,
            },
          ]).then(resolve);
        }
        return Promise.resolve([activity]).then(resolve);
      },
    };
    return query;
  }
  const transaction = {
    select,
    insert(table: unknown) {
      return {
        values(value: unknown) {
          insertedTables.push(table);
          if (table === activityRevisions) revisions.push(value);
          return Promise.resolve();
        },
      };
    },
    update(table: unknown) {
      return {
        set(patch: Record<string, unknown>) {
          updatedTables.push(table);
          return {
            where() {
              return {
                returning() {
                  if (table === activities) activity = { ...activity, ...patch };
                  if (table === callSessions && callSession) {
                    callSession = { ...callSession, ...patch };
                    return Promise.resolve([callSession]);
                  }
                  return Promise.resolve([activity]);
                },
              };
            },
          };
        },
      };
    },
  };
  return {
    transaction(callback: (tx: typeof transaction) => unknown) {
      return callback(transaction);
    },
    state: {
      get activity() { return activity; },
      get callSession() { return callSession; },
      get insertedTables() { return insertedTables; },
      get revisions() { return revisions; },
      get updatedTables() { return updatedTables; },
    },
  };
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
      deletedAt: null,
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

  it("links call disposition metadata through call session note activity ids", async () => {
    const linkedCall = row(
      "linked-call",
      new Date("2026-08-13T16:00:00.000Z"),
      new Date("2026-08-13T16:00:00.000Z"),
    );
    const unlinkedCall = row(
      "unlinked-call",
      new Date("2026-08-13T15:00:00.000Z"),
      new Date("2026-08-13T15:00:00.000Z"),
    );
    const repository = new DrizzleActivityRepository(
      databaseWithLinkedCallSessions(
        [linkedCall, unlinkedCall],
        [{
          id: "50000000-0000-4000-8000-000000000001",
          noteActivityId: "linked-call",
          disposition: "left_voicemail",
        }],
      ) as never,
    );

    const timeline = await repository.listTimeline({
      organizationId: "10000000-0000-4000-8000-000000000001",
    });

    expect(timeline.items).toEqual([
      expect.objectContaining({
        id: "linked-call",
        callOutcome: "left_voicemail",
        hasLinkedCallSession: true,
      }),
      expect.objectContaining({
        id: "unlinked-call",
        callOutcome: null,
        hasLinkedCallSession: false,
      }),
    ]);
  });

  it("returns linked call metadata after editing a linked call activity", async () => {
    const linkedCall = row(
      "linked-call",
      new Date("2026-08-13T16:00:00.000Z"),
      new Date("2026-08-13T16:00:00.000Z"),
    );
    const repository = new DrizzleActivityRepository(
      databaseWithEditableLinkedCall(
        linkedCall.activity,
        {
          id: "50000000-0000-4000-8000-000000000001",
          noteActivityId: "linked-call",
          disposition: "left_voicemail",
        },
      ) as never,
    );

    const result = await repository.edit({
      activityId: "linked-call",
      body: "updated linked call note",
      reason: "corrected details",
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) throw new Error("Expected edit to succeed.");
    expect(result.value).toMatchObject({
      id: "linked-call",
      body: "updated linked call note",
      revisionCount: 1,
      callOutcome: "left_voicemail",
      hasLinkedCallSession: true,
    });
  });

  it("atomically updates only the note body and linked call disposition", async () => {
    const linkedCall = row(
      "linked-call",
      new Date("2026-08-13T16:00:00.000Z"),
      new Date("2026-08-13T16:00:00.000Z"),
    );
    const database = databaseWithEditableLinkedCall(
      linkedCall.activity,
      {
        id: "50000000-0000-4000-8000-000000000001",
        noteActivityId: "linked-call",
        disposition: "left_voicemail",
      },
    );
    const repository = new DrizzleActivityRepository(database as never);

    const result = await repository.edit({
      activityId: "linked-call",
      body: "Corrected note",
      reason: "Corrected the saved call",
      callOutcome: "spoke_with_contact",
    });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    if (!result.ok) throw new Error("Expected edit to succeed.");
    expect(result.value).toMatchObject({
      id: "linked-call",
      body: "Corrected note",
      revisionCount: 1,
      callOutcome: "spoke_with_contact",
      hasLinkedCallSession: true,
    });
    expect(database.state.activity.body).toBe("Corrected note");
    expect(database.state.callSession?.disposition).toBe("spoke_with_contact");
    expect(database.state.revisions).toHaveLength(1);
    expect(database.state.insertedTables).toEqual([
      activityRevisions,
      auditEntries,
      auditEntries,
    ]);
    expect(database.state.insertedTables).not.toContain(bookings);
    expect(database.state.insertedTables).not.toContain(bookingContacts);
    expect(database.state.insertedTables).not.toContain(contacts);
    expect(database.state.insertedTables).not.toContain(followUps);
    expect(database.state.insertedTables).not.toContain(organizationContacts);
    expect(database.state.updatedTables).toEqual([callSessions, activities]);
    expect(database.state.updatedTables).not.toContain(bookings);
    expect(database.state.updatedTables).not.toContain(bookingContacts);
    expect(database.state.updatedTables).not.toContain(contacts);
    expect(database.state.updatedTables).not.toContain(followUps);
    expect(database.state.updatedTables).not.toContain(organizationContacts);
  });

  it("rejects call outcome edits for unlinked activities without changing the note", async () => {
    const unlinkedActivity = row(
      "unlinked-activity",
      new Date("2026-08-13T16:00:00.000Z"),
      new Date("2026-08-13T16:00:00.000Z"),
    );
    const database = databaseWithEditableLinkedCall(unlinkedActivity.activity, null);
    const repository = new DrizzleActivityRepository(database as never);

    const result = await repository.edit({
      activityId: "unlinked-activity",
      body: "Corrected note",
      reason: "Corrected the saved call",
      callOutcome: "spoke_with_contact",
    });

    expect(result).toEqual({
      ok: false,
      error: expect.objectContaining({ code: "INVALID_ACTIVITY_INPUT" }),
    });
    expect(database.state.activity.body).toBe("unlinked-activity");
    expect(database.state.revisions).toHaveLength(0);
    expect(database.state.updatedTables).toEqual([]);
  });
});
