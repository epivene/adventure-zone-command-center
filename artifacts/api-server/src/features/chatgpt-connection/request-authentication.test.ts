import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { authenticateConnectionRequest } from "./request-authentication";
import { ConnectionError, type ConnectionPrincipal } from "./contracts";

const principal: ConnectionPrincipal = {
  ownerId: "owner", clientId: "client", connectionId: "connection", scopes: ["crm:read"],
};
function fixture(verify: (token: string) => Promise<ConnectionPrincipal>) {
  const app = express();
  const work = vi.fn();
  app.post("/", async (req, res) => {
    const p = await authenticateConnectionRequest(req, res, {
      resource: "https://app.example/api/chatgpt/mcp", verify,
    });
    if (!p) return;
    work(p);
    res.json({ ok: true });
  });
  return { app, work };
}
describe("MCP authentication challenge boundary", () => {
  it("challenges absent credentials without invoking verification", async () => {
    const verify = vi.fn();
    const { app, work } = fixture(verify);
    const r = await request(app).post("/");
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toContain('error="invalid_token"');
    expect(verify).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
  it.each(["CONNECTION_ACCESS_DENIED", "CONNECTION_REVOKED"])("challenges real %s", async code => {
    const { app, work } = fixture(async () => { throw new ConnectionError(code, 401); });
    const r = await request(app).post("/").auth("test", { type: "bearer" });
    expect(r.status).toBe(401);
    expect(r.headers["www-authenticate"]).toContain("resource_metadata");
    expect(work).not.toHaveBeenCalled();
  });
  it.each(["Query read timeout", "connection terminated", "decrypt failed"])("does not demand reauthentication for %s", async message => {
    const verify = vi.fn().mockRejectedValueOnce(new Error(message)).mockResolvedValue(principal);
    const { app, work } = fixture(verify);
    const failed = await request(app).post("/").auth("same-token", { type: "bearer" });
    expect(failed.status).toBe(503);
    expect(failed.headers["www-authenticate"]).toBeUndefined();
    expect(failed.headers["retry-after"]).toBe("5");
    expect(failed.body.error).toBe("CONNECTION_AUTH_CHECK_UNAVAILABLE");
    expect(failed.text).not.toContain(message);
    expect(failed.text).not.toContain("same-token");
    expect(work).not.toHaveBeenCalled();
    const retry = await request(app).post("/").auth("same-token", { type: "bearer" });
    expect(retry.status).toBe(200);
    expect(work).toHaveBeenCalledExactlyOnceWith(principal);
  });
});
