import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPaperNoteReviewRouter } from "./paper-note-review";

const entryId = "30000000-0000-4000-8000-000000000001";

function appWith(service: any) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as express.Request & { userId: string }).userId = "owner";
    next();
  });
  app.use(createPaperNoteReviewRouter(service));
  return app;
}

const draft = {
  event: { name: "Emmett Cherry Festival", city: "Emmett", region: "ID", venue: "", eventDateText: "", startsOn: null, endsOn: null, pageYearConfirmed: false },
  activity: { occurredOn: null, method: "call", outcome: "", summary: "" },
  contacts: [],
  organizationPhones: [],
  oldReminder: "Call Monday",
  starredOnPaper: true,
  generalNotes: [],
  destination: null,
  conflicts: {},
  currentFollowUp: { enabled: false, kind: "call", dueOn: null, contactKey: null },
};

describe("paper-note review routes", () => {
  it("loads the current editable review", async () => {
    const getEntry = vi.fn(async () => ({ id: entryId, reviewVersion: 2, state: "needs_review", review: draft }));
    const response = await request(appWith({ getEntry }))
      .get(`/paper-notes/entries/${entryId}/review`);
    expect(response.status).toBe(200);
    expect(getEntry).toHaveBeenCalledWith("owner", entryId);
    expect(response.body.entry.reviewVersion).toBe(2);
  });

  it("saves corrections with an expected review version", async () => {
    const updateEntry = vi.fn(async (input) => ({ id: entryId, reviewVersion: 3, state: "needs_review", review: input.review }));
    const response = await request(appWith({ updateEntry }))
      .patch(`/paper-notes/entries/${entryId}`)
      .send({ expectedVersion: 2, review: draft });
    expect(response.status).toBe(200);
    expect(updateEntry).toHaveBeenCalledWith(expect.objectContaining({
      actorId: "owner",
      entryId,
      expectedVersion: 2,
    }));
  });

  it("keeps approval as a separate explicit action", async () => {
    const approveEntry = vi.fn(async () => ({ id: entryId, reviewVersion: 4, state: "approved", review: draft }));
    const response = await request(appWith({ approveEntry }))
      .post(`/paper-notes/entries/${entryId}/approve`)
      .send({ expectedVersion: 3 });
    expect(response.status).toBe(200);
    expect(approveEntry).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 3 }));
  });
});
