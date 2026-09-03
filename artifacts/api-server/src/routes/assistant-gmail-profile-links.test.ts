import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createAssistantGmailProfileLinksRouter } from "./assistant-gmail-profile-links";

const originalToken = process.env.ASSISTANT_IMPORT_TOKEN;

beforeAll(() => {
  process.env.ASSISTANT_IMPORT_TOKEN = "test-assistant-token";
});

afterAll(() => {
  if (originalToken === undefined) delete process.env.ASSISTANT_IMPORT_TOKEN;
  else process.env.ASSISTANT_IMPORT_TOKEN = originalToken;
});

function appFor() {
  const run = vi.fn(async () => ({
    after: "2026-01-01T00:00:00.000Z",
    before: "2027-01-01T00:00:00.000Z",
    repair: true,
    validationStatus: "approved" as const,
    pagesScanned: 2,
    counts: {
      examined: 120,
      sentInWindow: 75,
      alreadyLinked: 70,
      linked: 3,
      needsReview: 2,
      ignored: 0,
      failed: 0,
    },
    linked: [],
    needsReview: [],
    ignored: [],
    failed: [],
  }));
  const upsertRows = vi.fn(async () => undefined);
  const listApprovedForOrganization = vi.fn(async () => [{
    messageId: "1a03f76015409bfa",
    threadId: "1a03f6d13a293ebf",
    organizationId: "b447c83c-6348-4fab-b850-0db7a5576a83",
    contactId: null,
    evidenceCodes: ["exact_profile_name_subject", "sent_profile_link_sweep"],
  }]);
  const app = express();
  app.use(express.json());
  app.use(createAssistantGmailProfileLinksRouter({
    sweep: { run },
    validation: { listApprovedForOrganization, upsertRows },
  }));
  return { app, run, listApprovedForOrganization, upsertRows };
}

const authorization = { Authorization: "Bearer test-assistant-token" };

describe("assistant Gmail profile-link routes", () => {
  it("runs a bounded repair sweep behind the assistant token", async () => {
    const { app, run } = appFor();
    const response = await request(app)
      .post("/gmail-profile-links/sweep")
      .set(authorization)
      .send({
        after: "2026-01-01T00:00:00.000Z",
        before: "2027-01-01T00:00:00.000Z",
        repair: true,
      });

    expect(response.status).toBe(200);
    expect(run).toHaveBeenCalledWith({
      after: new Date("2026-01-01T00:00:00.000Z"),
      before: new Date("2027-01-01T00:00:00.000Z"),
      repair: true,
    });
    expect(response.body.counts.sentInWindow).toBe(75);
  });

  it("lists approved Gmail mappings for one exact profile", async () => {
    const { app, listApprovedForOrganization } = appFor();
    const profileId = "b447c83c-6348-4fab-b850-0db7a5576a83";
    const response = await request(app)
      .get(`/gmail-profile-links/profile/${profileId}`)
      .set(authorization);

    expect(response.status).toBe(200);
    expect(listApprovedForOrganization).toHaveBeenCalledWith(profileId);
    expect(response.body).toEqual({
      ok: true,
      organizationId: profileId,
      mappings: [
        expect.objectContaining({
          messageId: "1a03f76015409bfa",
          threadId: "1a03f6d13a293ebf",
        }),
      ],
    });
  });

  it("links one exact Gmail message to one exact profile", async () => {
    const { app, upsertRows } = appFor();
    const profileId = "b447c83c-6348-4fab-b850-0db7a5576a83";
    const response = await request(app)
      .put(`/gmail-profile-links/profile/${profileId}/messages/1a0683a8fcaeda83`)
      .set(authorization)
      .send({ threadId: "1a0683a8fcaeda83" });

    expect(response.status).toBe(200);
    expect(upsertRows).toHaveBeenCalledWith([{
      messageId: "1a0683a8fcaeda83",
      threadId: "1a0683a8fcaeda83",
      organizationId: profileId,
      contactId: null,
      evidenceCodes: ["assistant_approved_gmail_profile_link"],
    }]);
    expect(response.body).toEqual({
      ok: true,
      organizationId: profileId,
      messageId: "1a0683a8fcaeda83",
      threadId: "1a0683a8fcaeda83",
    });
  });

  it("rejects invalid windows and unauthorized requests", async () => {
    const { app, run } = appFor();
    const invalid = await request(app)
      .post("/gmail-profile-links/sweep")
      .set(authorization)
      .send({ after: "nope", before: "2027-01-01T00:00:00.000Z", repair: true });
    const unauthorized = await request(app)
      .get("/gmail-profile-links/profile/b447c83c-6348-4fab-b850-0db7a5576a83");

    expect(invalid.status).toBe(400);
    expect(run).not.toHaveBeenCalled();
    expect(unauthorized.status).toBe(401);
  });
});
