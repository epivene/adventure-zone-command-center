import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({ parse: vi.fn(), apply: vi.fn(), candidates: vi.fn() }));
vi.mock("@workspace/db", () => ({ db: {} }));
vi.mock("@/features/festivalnet-import/pdf-parser", () => ({ parseFestivalNetPdf: mocks.parse }));
vi.mock("@/features/festivalnet-import/import-service", () => ({
  applyFestivalNetDraft: mocks.apply, findFestivalNetCandidates: mocks.candidates,
  ImportConflict: class ImportConflict extends Error {},
}));
vi.mock("@/lib/auth", () => ({
  requireOwnerMiddleware: (req: express.Request, res: express.Response, next: express.NextFunction) =>
    req.headers.authorization === "Bearer owner-test" ? next() : res.status(401).json({ error: "Owner sign-in required." }),
}));
import router from "./festivalnet-import";

const draft = {
  name: "Example Festival", year: 2026, sourceUrl: "https://festivalnet.com/999999001/Example",
  sourceFilename: "example.pdf", details: { startsOn: "2026-10-03", endsOn: "2026-10-10" },
};
function app() {
  const app = express(); app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn: vi.fn(), error: vi.fn() } as any; next(); });
  app.use(router); return app;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.parse.mockResolvedValue({ draft, warnings: [] });
  mocks.candidates.mockResolvedValue([]);
  mocks.apply.mockResolvedValue({ organizationId: "11111111-1111-4111-8111-111111111111", created: true, filledFields: [], preservedFields: [] });
});
describe("FestivalNet import endpoints", () => {
  it("requires owner authorization before reading or saving a PDF", async () => {
    expect((await request(app()).post("/festivalnet-import/preview?filename=example.pdf").set("Content-Type", "application/pdf").send(Buffer.from("%PDF-test"))).status).toBe(401);
    expect((await request(app()).post("/festivalnet-import/apply").send({ draft, organizationId: null })).status).toBe(401);
    expect(mocks.parse).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("previews raw file bytes without writing records", async () => {
    const response = await request(app()).post("/festivalnet-import/preview?filename=example.pdf")
      .set("Authorization", "Bearer owner-test").set("Content-Type", "application/pdf").send(Buffer.from("%PDF-test"));
    expect(response.status).toBe(200); expect(response.body.draft.name).toBe("Example Festival");
    expect(mocks.apply).not.toHaveBeenCalled(); expect(mocks.parse.mock.calls[0][0]).toBeInstanceOf(Uint8Array);
  });
  it("rejects invalid links, email, date order, and year before touching stored data", async () => {
    for (const changes of [
      { year: 1800 }, { sourceUrl: "https://other.example/999999001/" },
      { website: "javascript:alert(1)" }, { contactEmail: "invalid-email" },
      { details: { startsOn: "2026-10-10", endsOn: "2026-10-03" } },
    ]) {
      const response = await request(app()).post("/festivalnet-import/apply").set("Authorization", "Bearer owner-test")
        .send({ draft: { ...draft, ...changes }, organizationId: null });
      expect(response.status).toBe(400);
    }
    expect(mocks.apply).not.toHaveBeenCalled();
  });
  it("saves only after an explicit reviewed apply request", async () => {
    const response = await request(app()).post("/festivalnet-import/apply").set("Authorization", "Bearer owner-test").send({ draft, organizationId: null });
    expect(response.status).toBe(200); expect(mocks.apply).toHaveBeenCalledWith(draft, null);
  });
});
