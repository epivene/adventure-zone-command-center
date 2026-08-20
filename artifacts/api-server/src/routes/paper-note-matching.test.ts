import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPaperNoteMatchingRouter } from "./paper-note-matching";

const entryId = "30000000-0000-4000-8000-000000000001";

function appWith(input: { getEntry: any; match: any }) {
  const app = express();
  app.use((req, _res, next) => {
    (req as express.Request & { userId: string }).userId = "owner";
    next();
  });
  app.use(createPaperNoteMatchingRouter(input as any));
  return app;
}

describe("paper-note matching route", () => {
  it("ranks matches from the current reviewed values without choosing one", async () => {
    const review = { destination: null, event: { name: "Emmett Cherry Festival" } };
    const getEntry = vi.fn(async () => ({ review }));
    const match = vi.fn(async () => [{
      organizationId: "10000000-0000-4000-8000-000000000001",
      organizationLocationId: null,
      name: "Emmett Cherry Festival",
      city: "Emmett",
      region: "ID",
      strength: "strong",
      score: 200,
      reasons: ["same phone number and extension"],
    }]);

    const response = await request(appWith({ getEntry, match }))
      .get(`/paper-notes/entries/${entryId}/matches`);

    expect(response.status).toBe(200);
    expect(getEntry).toHaveBeenCalledWith("owner", entryId);
    expect(match).toHaveBeenCalledWith(review);
    expect(response.body.matches[0].reasons).toContain("same phone number and extension");
    expect(review.destination).toBeNull();
  });
});
