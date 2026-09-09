import {
  Router,
  type IRouter,
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { z, ZodError } from "zod";
import { db } from "@workspace/db";
import { requireOwnerMiddleware } from "../lib/auth";
import {
  OutreachRepository,
  OutreachError,
} from "../features/outreach-planner/outreach-repository";
import { OutreachService } from "../features/outreach-planner/outreach-service";
import { createProductionOutreachAllocation } from "../features/outreach-planner/production-outreach-allocation";
export function createOutreachPlannerRouter(
  service = new OutreachService(
    new OutreachRepository(db),
    undefined,
    undefined,
    createProductionOutreachAllocation(db),
  ),
): IRouter {
  const router = Router();
  router.use(requireOwnerMiddleware);
  const run =
    (work: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        if (req.params.id) z.string().uuid().parse(req.params.id);
        res.json(await work(req));
      } catch (error) {
        if (error instanceof OutreachError) {
          res.status(error.status).json({ error: error.message });
          return;
        }
        if (error instanceof ZodError) {
          res
            .status(400)
            .json({ error: "Invalid planner request.", issues: error.issues });
          return;
        }
        next(error);
      }
    };
  const actor = (req: Request) => (req as Request & { userId: string }).userId;
  router.get(
    "/allocations",
    run(() => service.allocations()),
  );
  router.put(
    "/candidates/:id/demand",
    run((req) =>
      service.saveDemand(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.post(
    "/candidates/:id/holds",
    run((req) =>
      service.createHold(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.post(
    "/holds/:id/release",
    run((req) => service.releaseHold(String(req.params.id), actor(req))),
  );
  router.post(
    "/holds/:id/extend",
    run((req) =>
      service.extendHold(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.get(
    "/opportunities",
    run((req) => service.searchOpportunities(req.query)),
  );
  router.post(
    "/candidates/:id/history-review",
    run((req) =>
      service.reviewHistory(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.patch(
    "/openings/:id",
    run((req) =>
      service.setOpeningStatus(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.post(
    "/research/:id/results",
    run((req) =>
      service.saveResearchResults(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.get(
    "/",
    run(() => service.get()),
  );
  router.post(
    "/openings",
    run((req) => service.createOpening(req.body, actor(req))),
  );
  router.post(
    "/candidates",
    run((req) => service.createCandidate(req.body, actor(req))),
  );
  router.patch(
    "/candidates/:id",
    run((req) =>
      service.patchCandidate(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.get(
    "/candidates/:id/sources",
    run((req) => service.sources(String(req.params.id))),
  );
  router.post(
    "/candidates/:id/attempts",
    run((req) =>
      service.recordAttempt(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.post(
    "/candidates/:id/advance",
    run((req) => service.advance(String(req.params.id), actor(req))),
  );
  router.post(
    "/candidates/:id/check",
    run((req) => service.check(String(req.params.id), actor(req))),
  );
  router.post(
    "/openings/:id/research",
    run((req) => service.research(String(req.params.id), req.body, actor(req))),
  );
  return router;
}
