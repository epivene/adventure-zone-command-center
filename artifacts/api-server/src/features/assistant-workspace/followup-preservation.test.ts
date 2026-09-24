import { it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { DrizzleFollowUpRepository } from "../follow-ups/follow-up-repository";
import { FollowUpService } from "../follow-ups/follow-up-service";
it("adds an assistant reminder without closing manual reminders and replays once", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE follow_ups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,contact_id uuid,booking_id uuid,kind text,due_at timestamptz,completed_at timestamptz,outcome text,next_follow_up_id uuid,organization_location_id uuid,created_at timestamptz,updated_at timestamptz);
 INSERT INTO follow_ups(id,booking_id,kind,due_at) VALUES('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','Manual reminder',now());`);
    const service = new FollowUpService(
      new DrizzleFollowUpRepository(drizzle(db) as any),
    );
    const input = {
      organizationId: "33333333-3333-4333-8333-333333333333",
      contactId: null,
      bookingId: "22222222-2222-4222-8222-222222222222",
      kind: "email",
      dueAt: new Date("2027-01-02T17:00:00Z"),
    };
    const options = {
      preserveExisting: true,
      idempotencyId: "44444444-4444-4444-8444-444444444444",
    };
    await (service.create as any)(input, options);
    await (service.create as any)(input, options);
    const rows = (await db.query<any>("SELECT * FROM follow_ups")).rows;
    expect(rows).toHaveLength(2);
    expect(
      rows.find((r) => r.kind === "Manual reminder").completed_at,
    ).toBeNull();
  } finally {
    await db.close();
  }
});
