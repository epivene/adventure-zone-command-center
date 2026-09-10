import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ db: {}, pool: {} }));
vi.mock("@/features/boss/boss-account-repository", () => ({
  DrizzleBossAccountRepository: class {},
}));
vi.mock("@/features/boss/boss-middleware", () => ({
  createRequireBossMiddleware: () => (_req: any, _res: any, next: any) =>
    next(),
}));
import { createConventionRouter } from "./convention-outreach";
const id = "00000000-0000-4000-8000-000000000001";
const repo = {
  list: vi.fn(async () => []),
  updateEdition: vi.fn(),
  review: vi.fn(async () => ({ saved: true })),
};
function app(boss = false) {
  const app = express();
  app.use(express.json());
  app.use(
    createConventionRouter(
      repo as any,
      (req: any, res, next) => {
        if (req.headers.authorization !== "test")
          return void res.sendStatus(401);
        req.bossAccount = { accountId: "boss-1" };
        next();
      },
      boss,
    ),
  );
  return app;
}
describe("convention routes", () => {
  it("requires authentication to read lists", async () => {
    expect((await request(app()).get("/conventions")).status).toBe(401);
  });
  it("allows Boss review notes but exposes no plan editing endpoint", async () => {
    expect(
      (
        await request(app(true))
          .get("/boss/conventions")
          .set("Authorization", "test")
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app(true))
          .post(`/boss/conventions/${id}/review`)
          .set("Authorization", "test")
          .send({ revision: 1, note: "Read it" })
      ).status,
    ).toBe(200);
    expect(repo.review).toHaveBeenCalledWith(id, 1, "Read it", "boss:boss-1");
    expect(
      (
        await request(app(true))
          .patch(`/boss/conventions/${id}`)
          .set("Authorization", "test")
          .send({ revision: 1, summary: "overwrite" })
      ).status,
    ).toBe(404);
    expect(repo.updateEdition).not.toHaveBeenCalled();
  });
  it("rejects malformed revision values before updating the plan", async () => {
    expect(
      (
        await request(app())
          .patch(`/conventions/${id}`)
          .set("Authorization", "test")
          .send({
            revision: -1,
            summary: "",
            recommendation: "",
            sources: "",
            archived: false,
          })
      ).status,
    ).toBe(400);
    expect(repo.updateEdition).not.toHaveBeenCalled();
  });
});
