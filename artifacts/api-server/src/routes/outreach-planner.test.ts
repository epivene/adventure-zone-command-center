import { createHmac } from "node:crypto";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
vi.mock("@workspace/db", () => ({ db: {} }));
import { createOutreachPlannerRouter } from "./outreach-planner";
import { OutreachService } from "../features/outreach-planner/outreach-service";
import { OutreachRepository } from "../features/outreach-planner/outreach-repository";
import { issueToken } from "../lib/auth";
const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))),
  );
  vi.unstubAllEnvs();
});
async function setup(enabled = false) {
  vi.stubEnv("SESSION_SECRET", "planner-test-secret");
  const touches = vi.fn();
  const repo = new Proxy({} as OutreachRepository, {
    get() {
      touches();
      throw new Error("Unexpected database access");
    },
  });
  const service = new OutreachService(repo, () => enabled);
  const app = express();
  app.use(express.json());
  app.use("/outreach-planner", createOutreachPlannerRouter(service));
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}/outreach-planner`,
    touches,
    token: issueToken()!.token,
  };
}
describe("outreach owner routes", () => {
  it("rejects unauthenticated and manager-signed identities without database access", async () => {
    const { url, touches } = await setup();
    const payload = `manager.${Date.now() + 60000}`;
    const token = `${payload}.${createHmac("sha256", "planner-test-secret").update(payload).digest("base64url")}`;
    for (const headers of [{}, { Authorization: `Bearer ${token}` }]) {
      const response = await fetch(url, { headers });
      expect(response.status).toBe(401);
    }
    expect(touches).not.toHaveBeenCalled();
  });
  it("returns disabled state and rejects every mutation without planner table access", async () => {
    const { url, token, touches } = await setup();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    const response = await fetch(url, { headers });
    expect(await response.json()).toMatchObject({
      enabled: false,
      openings: [],
      candidates: [],
    });
    const id = "10000000-0000-4000-8000-000000000001";
    for (const [method, path] of [
      ["POST", "/openings"],
      ["POST", "/candidates"],
      ["PATCH", `/candidates/${id}`],
      ["POST", `/candidates/${id}/attempts`],
      ["POST", `/candidates/${id}/advance`],
      ["POST", `/candidates/${id}/check`],
      ["POST", `/candidates/${id}/history-review`],
      ["POST", `/openings/${id}/research`],
      ["PATCH", `/openings/${id}`],
      ["POST", `/research/${id}/results`],
    ])
      expect(
        (await fetch(url + path, { method, headers, body: "{}" })).status,
      ).toBe(404);
    expect(touches).not.toHaveBeenCalled();
  });
  it("validates UUID and rejects client-provided capacity results", async () => {
    const { url, token, touches } = await setup(true);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
    expect(
      (
        await fetch(url + "/candidates/not-a-uuid", {
          method: "PATCH",
          headers,
          body: "{}",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await fetch(url + "/openings", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "Bad",
            eventYear: 2026,
            startsOn: "2026-02-30",
            endsOn: "2026-03-01",
            legId: null,
            quantities: { zone: 1 },
            capacity: { status: "fits" },
          }),
        })
      ).status,
    ).toBe(400);
    expect(touches).not.toHaveBeenCalled();
  });
});
