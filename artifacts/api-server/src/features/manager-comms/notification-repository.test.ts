import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { NotificationRepository } from "./notification-repository";

const repo = new NotificationRepository(db);
const LEG = "00000000-0000-4000-8000-0000000000a1";

beforeAll(async () => {
  await repo.ensureSchema();
  await db.execute(sql.raw("truncate manager_notifications cascade"));
});
afterAll(async () => pool.end());

describe("NotificationRepository", () => {
  it("stores FYI message notifications separately from action-required notices", async () => {
    await repo.create({ legId: LEG, kind: "message", title: "New message", body: "Leg B sent a message", actionRequired: false, sourceType: "conversation", sourceId: "conversation-1" });
    await repo.create({ legId: LEG, kind: "admin_change", title: "Admin updated your leg", body: "Review changes", actionRequired: true, sourceType: "acknowledgment", sourceId: "ack-1" });
    const rows = await repo.listForLeg(LEG);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.kind === "message")?.actionRequired).toBe(false);
    expect(rows.find((row) => row.kind === "admin_change")?.actionRequired).toBe(true);
  });

  it("marks ordinary notifications read without deleting them", async () => {
    const notice = await repo.create({ legId: LEG, kind: "message", title: "New message", body: null, actionRequired: false, sourceType: "conversation", sourceId: "conversation-2" });
    await repo.markRead(notice.id, LEG);
    expect((await repo.listForLeg(LEG)).find((row) => row.id === notice.id)?.readAt).toBeInstanceOf(Date);
  });
});
