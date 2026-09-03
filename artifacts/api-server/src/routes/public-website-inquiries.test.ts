import cors from "cors";
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ createInquiry: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {} }));

import {
  createPublicWebsiteInquiriesRouter,
  createWebsiteInquiryCorsMiddleware,
  websiteInquiryBodyErrorHandler,
  websiteInquiryJsonParser,
} from "./public-website-inquiries";

const allowedOrigins = new Set(["https://the-adventure-zone.com"]);
const validInput = {
  submissionId: "10000000-0000-4000-8000-000000000001",
  name: "Desie Example",
  email: "desie@example.com",
  eventName: "Summer Festival",
  message: "Please send availability.",
  website: "",
  pageUrl: "https://the-adventure-zone.com/#contact",
};

function app(limiter = { consume: vi.fn(() => ({ allowed: true, retryAfterSeconds: 0 })) }) {
  const instance = express();
  instance.use("/public/website-inquiries", websiteInquiryJsonParser, websiteInquiryBodyErrorHandler);
  instance.use(
    createPublicWebsiteInquiriesRouter({
      service: { createInquiry: mocks.createInquiry },
      allowedOrigins,
      limiter,
    }),
  );
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createInquiry.mockResolvedValue({
    inquiryId: "20000000-0000-4000-8000-000000000002",
    referenceCode: "AZI-2026-AAAAAAAA",
    createdAt: new Date("2026-09-03T16:00:00Z"),
    duplicate: false,
  });
});

describe("public website inquiry route", () => {
  it("blocks a disallowed preflight before the app-wide CORS middleware can allow it", async () => {
    const instance = express();
    instance.use(
      "/api/public/website-inquiries",
      createWebsiteInquiryCorsMiddleware(allowedOrigins),
    );
    instance.use(cors({ origin: true }));

    const response = await request(instance)
      .options("/api/public/website-inquiries")
      .set("Origin", "https://evil.example")
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type");

    expect(response.status).toBe(403);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("accepts an allowed visitor without owner authentication", async () => {
    const response = await request(app())
      .post("/public/website-inquiries")
      .set("Origin", "https://the-adventure-zone.com")
      .send(validInput);

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      referenceCode: "AZI-2026-AAAAAAAA",
      message: expect.stringContaining("received"),
    });
    expect(response.body).not.toHaveProperty("matches");
  });

  it("returns the same safe success for a duplicate", async () => {
    mocks.createInquiry.mockResolvedValueOnce({
      inquiryId: "20000000-0000-4000-8000-000000000002",
      referenceCode: "AZI-2026-AAAAAAAA",
      createdAt: new Date(),
      duplicate: true,
    });
    const response = await request(app())
      .post("/public/website-inquiries")
      .set("Origin", "https://the-adventure-zone.com")
      .send(validInput);
    expect(response.status).toBe(200);
    expect(response.body.referenceCode).toBe("AZI-2026-AAAAAAAA");
  });

  it.each([
    [undefined, validInput],
    ["https://evil.example", validInput],
    ["https://the-adventure-zone.com", { ...validInput, pageUrl: "https://evil.example" }],
  ])("rejects a disallowed origin/page pair", async (origin, body) => {
    const pending = request(app()).post("/public/website-inquiries");
    if (origin) pending.set("Origin", origin);
    const response = await pending.send(body);
    expect(response.status).toBe(403);
    expect(mocks.createInquiry).not.toHaveBeenCalled();
  });

  it("rejects honeypots and unknown fields", async () => {
    for (const body of [
      { ...validInput, website: "robot" },
      { ...validInput, role: "owner" },
    ]) {
      const response = await request(app())
        .post("/public/website-inquiries")
        .set("Origin", "https://the-adventure-zone.com")
        .send(body);
      expect(response.status).toBe(400);
    }
  });

  it("returns retry guidance when rate limited", async () => {
    const response = await request(
      app({ consume: vi.fn(() => ({ allowed: false, retryAfterSeconds: 90 })) }),
    )
      .post("/public/website-inquiries")
      .set("Origin", "https://the-adventure-zone.com")
      .send(validInput);
    expect(response.status).toBe(429);
    expect(response.headers["retry-after"]).toBe("90");
  });

  it("returns JSON for oversized and temporary failures", async () => {
    const oversized = await request(app())
      .post("/public/website-inquiries")
      .set("Origin", "https://the-adventure-zone.com")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ ...validInput, message: "x".repeat(20_000) }));
    expect(oversized.status).toBe(413);
    expect(oversized.body.error).toBeTruthy();

    mocks.createInquiry.mockRejectedValueOnce(new Error("database offline"));
    const failed = await request(app())
      .post("/public/website-inquiries")
      .set("Origin", "https://the-adventure-zone.com")
      .send(validInput);
    expect(failed.status).toBe(503);
    expect(JSON.stringify(failed.body)).not.toContain("database offline");
  });
});
