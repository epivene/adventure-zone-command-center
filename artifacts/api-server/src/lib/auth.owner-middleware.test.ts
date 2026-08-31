import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  requireOwnerMiddleware: vi.fn(
    async (_req: Request, res: Response, _next: NextFunction): Promise<void> => {
      res.status(401).json({ error: "database owner required" });
    },
  ),
}));

vi.mock("@/features/owner-auth/owner-runtime", () => runtime);

import { issueToken, requireOwnerMiddleware } from "./auth";

const priorSecret = process.env.SESSION_SECRET;
const priorNodeEnv = process.env.NODE_ENV;

function app() {
  const instance = express();
  instance.get("/owner", requireOwnerMiddleware, (_req, res) => {
    res.json({ ok: true });
  });
  return instance;
}

beforeEach(() => {
  runtime.requireOwnerMiddleware.mockClear();
  process.env.SESSION_SECRET = "owner-compatibility-test-secret";
});

afterEach(() => {
  if (priorSecret === undefined) delete process.env.SESSION_SECRET;
  else process.env.SESSION_SECRET = priorSecret;
  if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = priorNodeEnv;
});

describe("legacy requireOwnerMiddleware import", () => {
  it("delegates to the database owner runtime outside tests", async () => {
    process.env.NODE_ENV = "production";
    const token = issueToken()!.token;

    const response = await request(app())
      .get("/owner")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(401);
    expect(runtime.requireOwnerMiddleware).toHaveBeenCalledOnce();
  });

  it("accepts the fixed compatibility token only under NODE_ENV=test", async () => {
    process.env.NODE_ENV = "test";
    const token = issueToken()!.token;

    const response = await request(app())
      .get("/owner")
      .set("Authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(runtime.requireOwnerMiddleware).not.toHaveBeenCalled();
  });
});
