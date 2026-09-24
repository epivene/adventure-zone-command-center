import { it, expect, vi } from "vitest";
import { captureSendSources } from "./send-sources";
function setup() {
  const draft: any = {
    content: {
      to: ["a@example.test"],
      cc: [],
      threadId: "thread",
      organizationId: "org",
      attachmentIds: [],
      eventYear: 2027,
      templateId: "template",
      templateVersion: "v1",
    },
  };
  const db = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("communication_templates")
        ? [
            {
              value: {
                state: "active",
                reviewed_at: "2026-09-24",
                template_version: "v1",
              },
            },
          ]
        : [{ value: { id: "source", version: "v1" } }],
    })),
  };
  const client = {
    getMessageMetadata: vi.fn().mockResolvedValue({ labelIds: ["INBOX"] }),
    listMessagePage: vi
      .fn()
      .mockResolvedValue({ messages: [{ id: "m1" }], nextPageToken: null }),
    getThreadDetail: vi.fn().mockResolvedValue({
      id: "thread",
      messages: [{ id: "m1", bodyText: "40% deposit" }],
    }),
  };
  return { draft, db, client };
}
it("changes the approval snapshot after incoming mail, document/rule changes or a thread correction", async () => {
  const s = setup();
  const original = await captureSendSources(s.db, s.client, s.draft);
  s.client.listMessagePage.mockResolvedValue({
    messages: [{ id: "m1" }, { id: "correction" }],
    nextPageToken: null,
  });
  expect(await captureSendSources(s.db, s.client, s.draft)).not.toBe(original);
  s.client.listMessagePage.mockResolvedValue({
    messages: [{ id: "m1" }],
    nextPageToken: null,
  });
  s.client.getThreadDetail.mockResolvedValue({
    id: "thread",
    messages: [{ id: "m1", bodyText: "Revised terms" }],
  });
  expect(await captureSendSources(s.db, s.client, s.draft)).not.toBe(original);
  const v = setup();
  v.db.query.mockImplementation(async (sql) => ({
    rows: sql.includes("communication_templates")
      ? [
          {
            value: {
              state: "active",
              reviewed_at: "2026-09-24",
              template_version: "v1",
            },
          },
        ]
      : [{ value: { id: "source", version: "v2" } }],
  }));
  expect(await captureSendSources(v.db, v.client, v.draft)).not.toBe(original);
});
it("fails closed on incomplete mail pagination or changed templates", async () => {
  const s = setup();
  s.client.listMessagePage.mockResolvedValue({
    messages: [],
    nextPageToken: "loop",
  });
  await expect(captureSendSources(s.db, s.client, s.draft)).rejects.toThrow(
    "ASSISTANT_SOURCE_HISTORY_INCOMPLETE",
  );
  const t = setup();
  t.draft.content.templateVersion = "old";
  await expect(captureSendSources(t.db, t.client, t.draft)).rejects.toThrow(
    "ASSISTANT_CURRENT_TEMPLATE_REQUIRED",
  );
});

it("requires a canonical booking matching the frozen profile and year", async () => {
  const s = setup();
  s.draft.content.bookingId = "booking";
  const original = s.db.query.getMockImplementation()!;
  s.db.query.mockImplementation(async (sql) =>
    sql.includes("FROM bookings") ? { rows: [] } : original(sql),
  );
  await expect(captureSendSources(s.db, s.client, s.draft)).rejects.toThrow(
    "ASSISTANT_BOOKING_YEAR_MISMATCH",
  );
});
