import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
vi.mock("@workspace/db", () => ({ pool: {} }));
import { createProfileDuplicatesRouter } from "./profile-duplicates";
import { issueToken } from "../lib/auth";

describe("duplicate review owner boundary", () => {
  it("rejects every read and write without the existing owner token", async () => {
    const scan = vi.fn(),
      merge = vi.fn();
    const app = express()
      .use(express.json())
      .use(createProfileDuplicatesRouter({ scan, merge } as any));
    for (const path of ["/profile-duplicates", "/profile-duplicates/history"])
      expect((await request(app).get(path)).status).toBe(401);
    for (const path of ["compare", "check", "merge", "dismiss", "undo"])
      expect(
        (await request(app).post(`/profile-duplicates/${path}`).send({}))
          .status,
      ).toBe(401);
    expect(scan).not.toHaveBeenCalled();
    expect(merge).not.toHaveBeenCalled();
  });
  it("allows owner scan and rejects invalid merge input before any service call", async () => {
    vi.stubEnv("SESSION_SECRET", "duplicate-review-test-only");
    try {
      const scan = vi.fn().mockResolvedValue({ scanned: 0, pairs: [] }),
        merge = vi.fn();
      const app = express()
        .use(express.json())
        .use(createProfileDuplicatesRouter({ scan, merge } as any));
      const auth = `Bearer ${issueToken()!.token}`;
      expect(
        (
          await request(app)
            .get("/profile-duplicates")
            .set("Authorization", auth)
        ).status,
      ).toBe(200);
      expect(
        (
          await request(app)
            .post("/profile-duplicates/merge")
            .set("Authorization", auth)
            .send({ confirmed: false })
        ).status,
      ).toBe(400);
      expect(merge).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
