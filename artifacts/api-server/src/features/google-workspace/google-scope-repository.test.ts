import { describe, expect, it, vi } from "vitest";

import { PostgresGoogleScopePersistence } from "./google-scope-repository";

function fakePool(options?: { failCalendarInsert?: boolean }) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const client = {
    query: vi.fn(async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      if (
        options?.failCalendarInsert &&
        text.includes("INSERT INTO google_workspace_calendar_scopes")
      ) {
        throw new Error("calendar insert failed");
      }
      if (text.includes("FROM google_workspace_label_scopes")) {
        return {
          rows: [
            {
              label_id: "shows",
              label_name: "Shows",
              root_label_id: "shows",
              root_label_name: "Shows",
            },
          ],
        };
      }
      if (text.includes("FROM google_workspace_calendar_scopes")) {
        return {
          rows: [
            {
              calendar_id: "az",
              summary: "Adventure Zone Calendar",
              primary_calendar: false,
            },
          ],
        };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return {
    calls,
    client,
    pool: { connect: vi.fn(async () => client) },
  };
}

describe("PostgresGoogleScopePersistence", () => {
  it("replaces labels, calendars, and audit metadata in one transaction", async () => {
    const harness = fakePool();
    const persistence = new PostgresGoogleScopePersistence(harness.pool);

    await persistence.replace({
      connectionId: "connection-id",
      labels: [
        {
          id: "shows",
          name: "Shows",
          rootId: "shows",
          rootName: "Shows",
        },
      ],
      calendars: [
        {
          id: "az",
          summary: "Adventure Zone Calendar",
          primary: false,
        },
      ],
      actorKind: "owner",
      actorId: "owner",
      now: new Date("2026-08-22T18:30:00.000Z"),
    });

    expect(harness.calls[0]?.text).toBe("BEGIN");
    expect(harness.calls.some((call) =>
      call.text.includes("DELETE FROM google_workspace_label_scopes"),
    )).toBe(true);
    expect(harness.calls.some((call) =>
      call.text.includes("INSERT INTO google_workspace_label_scopes"),
    )).toBe(true);
    expect(harness.calls.some((call) =>
      call.text.includes("INSERT INTO google_workspace_calendar_scopes"),
    )).toBe(true);
    expect(harness.calls.some((call) =>
      call.text.includes("INSERT INTO google_workspace_audit_events"),
    )).toBe(true);
    expect(harness.calls.at(-1)?.text).toBe("COMMIT");
    expect(harness.client.release).toHaveBeenCalledOnce();
  });

  it("rolls back and releases the client when any scope write fails", async () => {
    const harness = fakePool({ failCalendarInsert: true });
    const persistence = new PostgresGoogleScopePersistence(harness.pool);

    await expect(
      persistence.replace({
        connectionId: "connection-id",
        labels: [],
        calendars: [
          {
            id: "az",
            summary: "Adventure Zone Calendar",
            primary: false,
          },
        ],
        actorKind: "owner",
        actorId: "owner",
        now: new Date(),
      }),
    ).rejects.toThrow("calendar insert failed");

    expect(harness.calls.at(-1)?.text).toBe("ROLLBACK");
    expect(harness.client.release).toHaveBeenCalledOnce();
  });

  it("reads only selected saved scope", async () => {
    const harness = fakePool();
    const persistence = new PostgresGoogleScopePersistence(harness.pool);

    await expect(persistence.get("connection-id")).resolves.toEqual({
      labels: [
        {
          id: "shows",
          name: "Shows",
          rootId: "shows",
          rootName: "Shows",
        },
      ],
      calendars: [
        {
          id: "az",
          summary: "Adventure Zone Calendar",
          primary: false,
        },
      ],
    });
    expect(harness.calls.every((call) =>
      !call.text.includes("SELECT") || call.text.includes("selected = true"),
    )).toBe(true);
    expect(harness.client.release).toHaveBeenCalledOnce();
  });
});
