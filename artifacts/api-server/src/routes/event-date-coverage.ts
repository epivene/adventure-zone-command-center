import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db } from "@/db/client";
import { requireOwnerMiddleware } from "@/lib/auth";
import { CoverageRepository } from "@/features/event-date-coverage/coverage-repository";
import { CoverageJobRepository } from "@/features/event-date-coverage/coverage-job-repository";
import { EventDateRepository } from "@/features/event-date-coverage/event-date-repository";

const statusSchema = z.enum(["all", "booked", "confirmed", "expected", "missing", "stale", "needs_review"]);
const listSchema = z.object({
  search: z.string().max(200).optional().default(""), status: statusSchema.optional().default("all"),
  page: z.coerce.number().int().positive().optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
});
const runSchema = z.object({
  organizationIds: z.array(z.string().uuid()).max(100).optional(),
  batchSize: z.number().int().min(1).max(100).optional().default(25),
});
const reviewSchema = z.object({ decision: z.enum(["approve_confirmed", "approve_expected", "dismiss"]) });

type Dependencies = {
  coverage: Pick<CoverageRepository, "list">;
  jobs: Pick<CoverageJobRepository, "createRun" | "getRun" | "retryItem" | "listAttemptedOrganizationIds">;
  facts: {
    listFacts(organizationId: string): Promise<unknown[]>;
    review(factId: string, decision: z.infer<typeof reviewSchema>["decision"], actorId: string): Promise<unknown>;
  };
  canStartRun(): boolean;
};

const today = () => new Date().toISOString().slice(0, 10);

export function createEventDateCoverageRouter(
  dependencies: Dependencies,
  authorize: RequestHandler = requireOwnerMiddleware,
) {
  const router = Router();
  router.use(authorize);
  router.get("/event-date-coverage/summary", async (_req, res) => {
    const page = await dependencies.coverage.list({ today: today(), search: "", status: "all", page: 1, pageSize: 1 });
    res.json(page.summary);
  });
  router.get("/event-date-coverage/profiles", async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
    res.json(await dependencies.coverage.list({ today: today(), ...parsed.data }));
  });
  router.get("/event-date-coverage/profiles/:organizationId", async (req, res) => {
    res.json({ organizationId: req.params.organizationId, facts: await dependencies.facts.listFacts(String(req.params.organizationId)) });
  });
  router.post("/event-date-coverage/runs", async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
    if (!dependencies.canStartRun()) { res.status(429).json({ error: "Research start rate limit reached" }); return; }
    let organizationIds = parsed.data.organizationIds;
    if (!organizationIds) {
      const [page, attemptedIds] = await Promise.all([
        dependencies.coverage.list({ today: today(), search: "", status: "missing", page: 1, pageSize: Number.MAX_SAFE_INTEGER }),
        dependencies.jobs.listAttemptedOrganizationIds(),
      ]);
      const attempted = new Set(attemptedIds);
      organizationIds = page.records
        .filter((row) => !attempted.has(row.organizationId))
        .slice(0, parsed.data.batchSize)
        .map((row) => row.organizationId);
      if (!organizationIds.length) { res.status(409).json({ error: "No unresearched profiles with missing dates remain" }); return; }
    }
    const run = await dependencies.jobs.createRun({ organizationIds, batchSize: parsed.data.batchSize, requestedBy: String((req as any).userId ?? "owner") });
    res.status(201).json(run);
  });
  router.get("/event-date-coverage/runs/:runId", async (req, res) => {
    const run = await dependencies.jobs.getRun(String(req.params.runId));
    if (!run) { res.status(404).json({ error: "Coverage run not found" }); return; }
    res.json(run);
  });
  router.post("/event-date-coverage/items/:itemId/retry", async (req, res) => {
    const item = await dependencies.jobs.retryItem(String(req.params.itemId));
    if (!item) { res.status(404).json({ error: "Coverage item not found" }); return; }
    res.json(item);
  });
  router.post("/event-date-coverage/facts/:factId/review", async (req, res) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.issues[0]?.message }); return; }
    res.json(await dependencies.facts.review(String(req.params.factId), parsed.data.decision, String((req as any).userId ?? "owner")));
  });
  return router;
}

class SlidingStartLimit {
  private starts: number[] = [];
  take() {
    const cutoff = Date.now() - 60_000;
    this.starts = this.starts.filter((value) => value >= cutoff);
    if (this.starts.length >= 10) return false;
    this.starts.push(Date.now()); return true;
  }
}
const limiter = new SlidingStartLimit();
const eventDates = new EventDateRepository(db);
const defaultRouter = createEventDateCoverageRouter({
  coverage: CoverageRepository.fromDatabase(db), jobs: new CoverageJobRepository(db),
  facts: {
    listFacts: (organizationId) => eventDates.listFacts(organizationId),
    review: (factId, decision, actorId) => eventDates.reviewFact(factId, decision, actorId),
  },
  canStartRun: () => limiter.take(),
});
export default defaultRouter;
