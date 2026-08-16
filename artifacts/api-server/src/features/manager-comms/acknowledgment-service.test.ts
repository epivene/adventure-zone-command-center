import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { AcknowledgmentRepository } from "./acknowledgment-repository";
import { AcknowledgmentService } from "./acknowledgment-service";

const LEG_A = "00000000-0000-4000-8000-0000000000a1";
const LEG_B = "00000000-0000-4000-8000-0000000000b2";
const ACTION_ID = "00000000-0000-4000-8000-00000000a600";

const repository = new AcknowledgmentRepository(db);
const service = new AcknowledgmentService(repository);

beforeAll(async () => {
  await repository.ensureSchema();
  await db.execute(`truncate manager_acknowledgment_events, manager_acknowledgment_items, manager_acknowledgments cascade` as any);
});

afterAll(async () => { await pool.end(); });

describe("AcknowledgmentService", () => {
  it("creates one grouped acknowledgment per admin action for each affected leg", async () => {
    const rows = await service.recordAdminOperationalChange({
      actionId: ACTION_ID,
      legIds: [LEG_A, LEG_B, LEG_A],
      actor: "Admin",
      sourceType: "booking",
      sourceId: "booking-123",
      title: "Event time changed",
      items: [
        { label: "Start time", beforeValue: "4:00 PM", afterValue: "5:00 PM" },
        { label: "Load-in", beforeValue: "2:00 PM", afterValue: "3:00 PM" },
      ],
    });

    expect(rows).toHaveLength(2);
    const legA = await repository.listForLeg(LEG_A);
    expect(legA).toHaveLength(1);
    expect(legA[0]?.items).toHaveLength(2);
    expect(legA[0]?.status).toBe("waiting_acknowledgment");

    const retry = await service.recordAdminOperationalChange({
      actionId: ACTION_ID,
      legIds: [LEG_A, LEG_B],
      actor: "Admin",
      sourceType: "booking",
      sourceId: "booking-123",
      title: "Event time changed",
      items: [{ label: "Start time", beforeValue: "4:00 PM", afterValue: "5:00 PM" }],
    });
    expect(retry.map((row) => row.id)).toEqual(rows.map((row) => row.id));
  });

  it("persists until manager acknowledgment, with comments requiring admin review", async () => {
    const [created] = await service.recordAdminOperationalChange({
      actionId: "00000000-0000-4000-8000-00000000a601",
      legIds: [LEG_A],
      actor: "Admin",
      sourceType: "handoff",
      sourceId: "handoff-1",
      title: "Equipment meetup changed",
      items: [{ label: "Meetup", beforeValue: "Mandan", afterValue: "Bismarck" }],
    });
    expect(created).toBeTruthy();

    const commented = await service.acknowledge(created!.id, LEG_A, "Can we make that 30 minutes later?");
    expect(commented.status).toBe("needs_admin_review");
    expect(commented.acknowledgedAt).toBeInstanceOf(Date);
    expect(commented.managerComment).toContain("30 minutes later");

    const stillVisible = await repository.listForLeg(LEG_A);
    expect(stillVisible.find((row) => row.id === created!.id)?.status).toBe("needs_admin_review");
  });

  it("allows a simple acknowledge to leave the active queue without deleting history", async () => {
    const [created] = await service.recordAdminOperationalChange({
      actionId: "00000000-0000-4000-8000-00000000a602",
      legIds: [LEG_A],
      actor: "Admin",
      sourceType: "crew_assignment",
      sourceId: "crew-1",
      title: "Crew assignment changed",
      items: [{ label: "Worker", beforeValue: "Sam", afterValue: "Jordan" }],
    });

    const acknowledged = await service.acknowledge(created!.id, LEG_A, null);
    expect(acknowledged.status).toBe("acknowledged");
    expect((await repository.listActiveForLeg(LEG_A)).some((row) => row.id === created!.id)).toBe(false);
    expect((await repository.listForLeg(LEG_A)).some((row) => row.id === created!.id)).toBe(true);
  });

  it("admin resolution preserves manager comment and audit events", async () => {
    const [created] = await service.recordAdminOperationalChange({
      actionId: "00000000-0000-4000-8000-00000000a603",
      legIds: [LEG_A],
      actor: "Admin",
      sourceType: "trip",
      sourceId: "trip-1",
      title: "Route changed",
      items: [{ label: "Stop", beforeValue: "A", afterValue: "B" }],
    });
    await service.acknowledge(created!.id, LEG_A, "Please double-check this stop.");
    const resolved = await service.resolve(created!.id, "Confirmed — stop B is correct.", "Admin");

    expect(resolved.status).toBe("resolved");
    expect(resolved.managerComment).toContain("double-check");
    expect(resolved.adminResponse).toContain("stop B is correct");
    const history = await repository.listEvents(created!.id);
    expect(history.map((event) => event.kind)).toEqual(expect.arrayContaining(["created", "manager_commented", "resolved"]));
  });
});
