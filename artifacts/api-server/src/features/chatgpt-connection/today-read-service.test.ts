import { it, expect } from "vitest";
import { fixture } from "./test-database";
import { TodayReadService } from "./today-read-service";
it("reads current queue sections with profile filtering, bounded pages and stale-page detection", async () => {
  const f = await fixture();
  try {
    let rows: any[] = [
      {
        id: "one",
        organizationId: f.profileId,
        attentionState: "waiting_for_their_reply",
        dueAt: new Date("2026-10-08T16:00:00Z"),
      },
      {
        id: "two",
        organizationId: f.profileId,
        attentionState: "needs_your_reply",
      },
      { id: "other", organizationId: "other" },
    ];
    const service = new TodayReadService(
      f.db,
      async () => ({ needsAttention: rows, active: [], completedToday: [] }),
      () => new Date("2026-10-02T00:30:00Z"),
    );
    const first = await service.read(f.principal, {
      profileId: f.profileId,
      limit: 1,
    });
    expect(first.businessDate).toBe("2026-10-01");
    expect(first.total).toBe(2);
    expect(first.items[0].id).toBe("one");
    expect(first.nextCursor).toBeTruthy();
    const second = await service.read(f.principal, {
      profileId: f.profileId,
      limit: 1,
      cursor: first.nextCursor!,
    });
    expect(second.items[0].id).toBe("two");
    expect(second.nextCursor).toBeNull();
    rows = rows.slice(1);
    await expect(
      service.read(f.principal, {
        profileId: f.profileId,
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow("TODAY_QUEUE_CHANGED");
    expect(
      (await service.read(f.principal, { section: "completedToday" })).items,
    ).toEqual([]);
    await expect(
      service.read(f.principal, { cursor: "not-a-cursor" }),
    ).rejects.toThrow("TODAY_CURSOR_INVALID");
    await expect(service.read(f.principal, { limit: 51 })).rejects.toThrow();
    await expect(
      service.read({ ...f.principal, ownerId: "different-owner" }, {}),
    ).rejects.toThrow("CONNECTION_ACCESS_DENIED");
    await expect(
      service.read({ ...f.principal, scopes: [] }, {}),
    ).rejects.toThrow();
    await f.db.query(
      "UPDATE chatgpt_connections SET revoked_at=now() WHERE id=$1",
      [f.principal.connectionId],
    );
    await expect(service.read(f.principal, {})).rejects.toThrow(
      "CONNECTION_REVOKED",
    );
  } finally {
    await f.db.close();
  }
});
