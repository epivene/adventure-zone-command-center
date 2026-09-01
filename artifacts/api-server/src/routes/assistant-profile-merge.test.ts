import express from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const addProfileAsLocation = vi.fn();

vi.mock("@/features/organizations/add-profile-as-location", () => ({
  addProfileAsLocation,
}));

import router from "./assistant-profile-integrity";

const originalToken = process.env.ASSISTANT_IMPORT_TOKEN;
const authorization = { Authorization: "Bearer test-assistant-token" };

beforeAll(() => {
  process.env.ASSISTANT_IMPORT_TOKEN = "test-assistant-token";
});

afterAll(() => {
  if (originalToken === undefined) delete process.env.ASSISTANT_IMPORT_TOKEN;
  else process.env.ASSISTANT_IMPORT_TOKEN = originalToken;
});

beforeEach(() => {
  addProfileAsLocation.mockReset();
});

function appFor() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("assistant protected profile merge", () => {
  it("retires one duplicate into the selected canonical profile", async () => {
    addProfileAsLocation.mockResolvedValue({ locationId: "17525480-8f32-46db-890b-a3f46c5e3abc" });

    const response = await request(appFor())
      .post("/profile-merge")
      .set(authorization)
      .send({
        canonicalOrgId: "6813439b-4ba6-478c-9c51-70b583914e9e",
        sourceOrgId: "93ee6ee1-9bea-403e-a83c-83a3de8566d4",
        label: "Payson, AZ",
      });

    expect(response.status).toBe(200);
    expect(addProfileAsLocation).toHaveBeenCalledWith(
      expect.anything(),
      {
        canonicalOrgId: "6813439b-4ba6-478c-9c51-70b583914e9e",
        sourceOrgId: "93ee6ee1-9bea-403e-a83c-83a3de8566d4",
        label: "Payson, AZ",
      },
      expect.any(Date),
    );
    expect(response.body).toEqual({
      ok: true,
      canonicalOrgId: "6813439b-4ba6-478c-9c51-70b583914e9e",
      sourceOrgId: "93ee6ee1-9bea-403e-a83c-83a3de8566d4",
      locationId: "17525480-8f32-46db-890b-a3f46c5e3abc",
    });
  });

  it("rejects invalid and unauthorized merge requests", async () => {
    const invalid = await request(appFor())
      .post("/profile-merge")
      .set(authorization)
      .send({ canonicalOrgId: "nope", sourceOrgId: "also-nope" });
    const unauthorized = await request(appFor())
      .post("/profile-merge")
      .send({
        canonicalOrgId: "6813439b-4ba6-478c-9c51-70b583914e9e",
        sourceOrgId: "93ee6ee1-9bea-403e-a83c-83a3de8566d4",
      });

    expect(invalid.status).toBe(400);
    expect(unauthorized.status).toBe(401);
    expect(addProfileAsLocation).not.toHaveBeenCalled();
  });
});
