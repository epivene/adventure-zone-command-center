import { reviewInboundObservation } from "../features/outreach-planner/outreach-inbound";
import { createProductionOutreachDispatch } from "../features/outreach-planner/production-outreach-dispatch";
import { draftKindInput } from "../features/outreach-planner/outreach-dispatch";
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
  const dispatch = () => {
    service.gate();
    return createProductionOutreachDispatch(service.repository.db);
  };
  router.put(
    "/drafts/office_email/:id/identity",
    run((req) =>
      dispatch().assignOfficeIdentity(
        String(req.params.id),
        req.body,
        (req as Request & { userId: string }).userId,
      ),
    ),
  );
  router.post(
    "/drafts/:kind/:id/review-content",
    run((req) =>
      dispatch().review(
        draftKindInput.parse(req.params.kind),
        String(req.params.id),
        req.body,
      ),
    ),
  );
  router.put(
    "/drafts/:kind/:id/approval",
    run((req) =>
      dispatch().approve(
        draftKindInput.parse(req.params.kind),
        String(req.params.id),
        req.body,
        (req as Request & { userId: string }).userId,
      ),
    ),
  );
  router.post(
    "/inbound-observations/:id/review",
    run((req) =>
      reviewInboundObservation(
        dispatch().db,
        String(req.params.id),
        req.body,
        (req as Request & { userId: string }).userId,
      ),
    ),
  );
  router.get(
    "/dispatches",
    run(() => dispatch().list()),
  );
  router.post(
    "/dispatches/:id/reconcile",
    run((req) =>
      dispatch().reconcile(
        String(req.params.id),
        req.body,
        (req as Request & { userId: string }).userId,
      ),
    ),
  );
  const actor = (req: Request) => (req as Request & { userId: string }).userId;
  router.post(
    "/reconciliations/:id/source-review",
    run((req) =>
      service.reviewImportedClaimSource(
        String(req.params.id),
        req.body,
        actor(req),
      ),
    ),
  );
  router.post(
    "/route-anchors",
    run((req) => service.saveRouteAnchor(req.body, actor(req))),
  );
  router.post(
    "/route-anchors/:id/revoke",
    run((req) =>
      service.revokeRouteAnchor(String(req.params.id), req.body, actor(req)),
    ),
  );
  router.put(
    "/bookings/:id/committed-demand",
    run((req) =>
      service.reconcileCommittedDemand(
        String(req.params.id),
        req.body,
        actor(req),
      ),
    ),
  );
  router.post(
    "/bookings/:id/commitment-change",
    run((req) =>
      service.changeCommitment(String(req.params.id), req.body, actor(req)),
    ),
  );
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
    "/recovery",
    run((req) => service.recoveryCatalog(req.query)),
  );
  router.get(
    "/profiles",
    run((req) => service.searchProfiles(req.query)),
  );
  router.post(
    "/opportunities/admit",
    run((req) => service.admitProfile(req.body, actor(req))),
  );
  router.post(
    "/opportunities/:id/bind-booking",
    run((req) => service.bindOpportunity(String(req.params.id), req.body, actor(req))),
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
    "/candidates/:id/source-review",
    run((req) =>
      service.reviewActualSource(String(req.params.id), req.body, actor(req)),
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
