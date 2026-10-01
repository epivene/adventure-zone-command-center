import express from "express";
import request from "supertest";
import { beforeEach, afterEach, it, expect } from "vitest";
import { fixture } from "../features/chatgpt-connection/test-database";
import { ensureBookingWorkSchema } from "../db/booking-work-schema";
import { createBookingWorkRouter } from "./booking-work";
import { issueToken } from "../lib/auth";
let f: Awaited<ReturnType<typeof fixture>>, app: express.Express, token: string;
beforeEach(async () => {
  process.env.SESSION_SECRET = "test-booking-work-secret";
  f = await fixture();
  await ensureBookingWorkSchema(f.db);
  app = express();
  app.use(express.json());
  app.use("/booking-work", createBookingWorkRouter(f.db));
  token = issueToken()!.token;
});
afterEach(async () => {
  await f?.db.close();
});
it("requires owner auth and validates request fields", async () => {
  expect((await request(app).get("/booking-work")).status).toBe(401);
  expect(
    (
      await request(app)
        .post("/booking-work")
        .set("Authorization", `Bearer ${token}`)
        .send({ profileId: f.profileId, send: true })
    ).status,
  ).toBe(400);
});
it("creates, reads, and returns current record on a stale update", async () => {
  const h = { Authorization: `Bearer ${token}` };
  const r = await request(app)
    .post("/booking-work")
    .set(h)
    .send({
      profileId: f.profileId,
      eventYear: 2027,
      queue: "replies",
      title: "Fair reply",
      nextAction: "Read",
    });
  expect(r.status).toBe(201);
  const id = r.body.activity.id;
  expect(
    (await request(app).get("/booking-work").set(h)).body.items,
  ).toHaveLength(1);
  expect(
    (
      await request(app)
        .patch(`/booking-work/${id}`)
        .set(h)
        .send({ revision: 1, patch: { nextAction: "My edits" } })
    ).status,
  ).toBe(200);
  const stale = await request(app)
    .patch(`/booking-work/${id}`)
    .set(h)
    .send({ revision: 1, patch: { nextAction: "stale" } });
  expect(stale.status).toBe(409);
  expect(stale.body.current.nextAction).toBe("My edits");
});
