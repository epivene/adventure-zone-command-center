import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import { createWebsiteInquiryAuthorization } from "./website-inquiry-authorization";

function app(input: {
  owner?: boolean;
  office?: {
    accountId: string;
    displayName: string;
    role: "office_coordinator";
    canReviewWebsiteInquiries: boolean;
  } | null;
}) {
  const instance = express();
  instance.get(
    "/website-inquiries",
    createWebsiteInquiryAuthorization({
      verifyOwnerToken: vi.fn(() => input.owner ?? false),
      resolveOfficeToken: vi.fn(async () => input.office ?? null),
    }),
    (req, res) => res.json({ actor: req.websiteInquiryActor }),
  );
  return instance;
}

describe("website inquiry authorization", () => {
  it("authorizes an owner bearer token before trying Office auth", async () => {
    const response = await request(app({ owner: true }))
      .get("/website-inquiries")
      .set("Authorization", "Bearer owner-token");
    expect(response.status).toBe(200);
    expect(response.body.actor).toEqual({
      kind: "owner",
      id: "owner",
      name: "Desie",
    });
  });

  it("authorizes a permitted current Office session", async () => {
    const response = await request(
      app({
        office: {
          accountId: "amy-id",
          displayName: "Amy",
          role: "office_coordinator",
          canReviewWebsiteInquiries: true,
        },
      }),
    )
      .get("/website-inquiries")
      .set("Authorization", "Bearer office-token");
    expect(response.status).toBe(200);
    expect(response.body.actor).toEqual({
      kind: "office",
      id: "amy-id",
      name: "Amy",
    });
  });

  it("returns 403 for a valid Office session without the permission", async () => {
    const response = await request(
      app({
        office: {
          accountId: "office-id",
          displayName: "Office User",
          role: "office_coordinator",
          canReviewWebsiteInquiries: false,
        },
      }),
    )
      .get("/website-inquiries")
      .set("Authorization", "Bearer office-token");
    expect(response.status).toBe(403);
  });

  it.each([
    ["missing", undefined],
    ["invalid", "Bearer invalid"],
    ["expired", "Bearer expired-office-token"],
    ["manager", "Bearer manager.token.value"],
  ])("returns 401 for %s authentication", async (_label, header) => {
    const pending = request(app({ office: null })).get("/website-inquiries");
    if (header) pending.set("Authorization", header);
    const response = await pending;
    expect(response.status).toBe(401);
  });
});
