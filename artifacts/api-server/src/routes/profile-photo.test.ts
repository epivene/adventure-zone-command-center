import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.hoisted(() => vi.fn());
vi.mock("@workspace/db", () => ({ db: { execute } }));

import router from "./profile-photo";

function app() {
  const instance = express();
  instance.use(express.json({ limit: "2mb" }));
  instance.use(router);
  return instance;
}

const profileId = "10000000-0000-4000-8000-000000000001";

describe("profile photo routes", () => {
  beforeEach(() => execute.mockReset());

  it("returns the shared stored photo", async () => {
    execute.mockResolvedValue({ rows: [{ dataUrl: "data:image/jpeg;base64,YQ==" }] });
    const response = await request(app()).get(`/event-profiles/${profileId}/photo`);
    expect(response.status).toBe(200);
    expect(response.body.dataUrl).toBe("data:image/jpeg;base64,YQ==");
  });

  it("saves a size-limited image data URL", async () => {
    execute.mockResolvedValue({ rows: [{ id: profileId }] });
    const dataUrl = "data:image/jpeg;base64,YQ==";
    const response = await request(app()).patch(`/event-profiles/${profileId}/photo`).send({ dataUrl });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, dataUrl });
  });

  it("rejects non-image data URLs", async () => {
    const response = await request(app()).patch(`/event-profiles/${profileId}/photo`).send({ dataUrl: "data:text/plain;base64,YQ==" });
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
});
