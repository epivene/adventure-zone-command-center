import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({ db: {} }));

import {
  WebsiteInquiryNotFoundError,
  WebsiteInquiryTransitionError,
} from "../features/website-inquiries/website-inquiry-review-service";
import { createWebsiteInquiriesRouter } from "./website-inquiries";

const inquiryId = "20000000-0000-4000-8000-000000000002";
const mocks = {
  list: vi.fn(),
  count: vi.fn(),
  detail: vi.fn(),
  changeStatus: vi.fn(),
  matches: vi.fn(),
  search: vi.fn(),
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(
    createWebsiteInquiriesRouter({
      authorize(req, _res, next) {
        req.websiteInquiryActor = {
          kind: "owner",
          id: "owner",
          name: "Owner",
        };
        next();
      },
      service: mocks,
    }),
  );
  return instance;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue({ items: [], nextCursor: null });
  mocks.count.mockResolvedValue({ newCount: 2 });
  mocks.detail.mockResolvedValue({ inquiry: { id: inquiryId }, auditHistory: [] });
  mocks.changeStatus.mockResolvedValue({ id: inquiryId, status: "reviewing" });
  mocks.matches.mockResolvedValue({ contacts: [], organizations: [], parsedLocation: null });
  mocks.search.mockResolvedValue([]);
});

describe("website inquiry review routes", () => {
  it("lists a validated status page", async () => {
    const response = await request(app()).get(
      "/website-inquiries?status=new&limit=25&cursor=2026-09-03T16%3A00%3A00.000Z%2C20000000-0000-4000-8000-000000000002",
    );
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith({
      status: "new",
      limit: 25,
      cursor: `2026-09-03T16:00:00.000Z,${inquiryId}`,
    });
  });

  it("returns the new count and complete detail", async () => {
    expect((await request(app()).get("/website-inquiries/count")).body).toEqual({
      newCount: 2,
    });
    const detail = await request(app()).get(`/website-inquiries/${inquiryId}`);
    expect(detail.status).toBe(200);
    expect(detail.body.inquiry.id).toBe(inquiryId);
  });

  it("applies a strict status action with the authorized actor", async () => {
    const response = await request(app())
      .patch(`/website-inquiries/${inquiryId}/status`)
      .send({ action: "archive" });
    expect(response.status).toBe(200);
    expect(mocks.changeStatus).toHaveBeenCalledWith({
      inquiryId,
      action: "archive",
      actor: { kind: "owner", id: "owner", name: "Owner" },
    });
  });

  it("returns protected suggestions and bounded manual search results", async () => {
    const matches = await request(app()).get(
      `/website-inquiries/${inquiryId}/matches`,
    );
    expect(matches.status).toBe(200);
    expect(mocks.matches).toHaveBeenCalledWith(inquiryId);

    const search = await request(app()).get(
      "/website-inquiries/search?entity=contact&q=desie",
    );
    expect(search.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith({
      entity: "contact",
      query: "desie",
    });
  });

  it.each([
    ["short search", "/website-inquiries/search?entity=contact&q=d"],
    ["bad search entity", "/website-inquiries/search?entity=booking&q=festival"],
  ])("returns 400 for %s", async (_label, path) => {
    expect((await request(app()).get(path)).status).toBe(400);
  });

  it.each([
    ["bad status", "/website-inquiries?status=deleted", undefined],
    ["bad cursor", "/website-inquiries?cursor=not-a-cursor", undefined],
    ["bad id", "/website-inquiries/not-an-id", undefined],
    ["unknown field", `/website-inquiries/${inquiryId}/status`, { action: "archive", role: "owner" }],
    ["bad action", `/website-inquiries/${inquiryId}/status`, { action: "delete" }],
  ])("returns 400 for %s", async (_label, path, body) => {
    const pending = body
      ? request(app()).patch(path).send(body)
      : request(app()).get(path);
    expect((await pending).status).toBe(400);
  });

  it("maps missing inquiries to 404 and invalid transitions to 409", async () => {
    mocks.detail.mockRejectedValueOnce(new WebsiteInquiryNotFoundError());
    expect(
      (await request(app()).get(`/website-inquiries/${inquiryId}`)).status,
    ).toBe(404);

    mocks.changeStatus.mockRejectedValueOnce(new WebsiteInquiryTransitionError());
    expect(
      (
        await request(app())
          .patch(`/website-inquiries/${inquiryId}/status`)
          .send({ action: "archive" })
      ).status,
    ).toBe(409);
  });
});
