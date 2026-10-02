import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type ErrorRequestHandler,
} from "express";
import { z } from "zod";
import {
  planDraftSchema,
  legSeasonPlanInputSchema,
  crewAvailabilityInputSchema,
  packageSetInputSchema,
  splitGroupInputSchema,
  daveAuthorityInputSchema,
  approvalRequestInputSchema,
  decisionWriteInputSchema,
  revisionWriteSchema,
  commitPlansInputSchema,
  type PlanningActor,
} from "@workspace/api-zod";
import type { LegPlanningService } from "../features/leg-planning/planning-service";
import { PlanningError } from "../features/leg-planning/planning-repository";
import { planningEnabled } from "../features/leg-planning/planning-writer-hooks";
const id = z.string().uuid(),
  year = z.coerce.number().int().min(1900).max(9998);
function actorFor(
  req: Request,
  role: "owner" | "boss" | "manager",
): PlanningActor {
  if (role === "owner") {
    const subject = (req as Request & { userId?: string }).userId;
    if (typeof subject !== "string")
      throw new PlanningError(401, "AUTHENTICATION_REQUIRED");
    return { kind: "owner", subject };
  }
  if (role === "boss" && req.bossAccount?.sessionVersion)
    return {
      kind: "boss",
      accountId: req.bossAccount.accountId,
      sessionVersion: req.bossAccount.sessionVersion,
    };
  if (role === "manager" && req.legManager?.sessionVersion)
    return {
      kind: "manager",
      legId: req.legManager.legId,
      sessionVersion: req.legManager.sessionVersion,
    };
  throw new PlanningError(401, "AUTHENTICATION_REQUIRED");
}
export function createLegPlanningRouter(deps: {
  service: LegPlanningService;
  requireOwner: RequestHandler;
  requireBoss: RequestHandler;
  requireManager: RequestHandler;
}): IRouter {
  const router = Router();
  const gate: RequestHandler = (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!planningEnabled()) {
      res
        .status(404)
        .json({
          code: "PLANNING_DISABLED",
          error: "Leg planning is not enabled.",
        });
      return;
    }
    next();
  };
  for (const role of ["owner", "boss", "manager"] as const) {
    const prefix = role === "owner" ? "" : `/${role}`,
      auth =
        role === "owner"
          ? deps.requireOwner
          : role === "boss"
            ? deps.requireBoss
            : deps.requireManager;
    const handle =
      (
        work: (req: Request, actor: PlanningActor) => Promise<unknown>,
      ): RequestHandler =>
      async (req, res, next) => {
        try {
          for (const key of ["id", "legId"]) {
            if (req.params[key] && !id.safeParse(req.params[key]).success) {
              res
                .status(400)
                .json({ code: "INVALID_ID", error: "Choose a valid record." });
              return;
            }
          }
          const result = await work(req, actorFor(req, role));
          res.json(result);
        } catch (e) {
          next(e);
        }
      };
    router.get(
      `${prefix}/leg-planning/catalog`,
      auth,
      gate,
      handle((_req, a) => deps.service.catalog(a)),
    );
    router.get(
      `${prefix}/bookings/:id/operating-plan`,
      auth,
      gate,
      handle(async (req, a) => {
        const r = await deps.service.get(String(req.params.id), a);
        if (!r) throw new PlanningError(404, "BOOKING_NOT_FOUND");
        return r;
      }),
    );
    router.patch(
      `${prefix}/bookings/:id/operating-plan`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(planDraftSchema).parse(req.body);
        if (p.payload.bookingId !== req.params.id)
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.saveDraft(a, p);
      }),
    );
    router.post(
      `${prefix}/operating-plans/commit`,
      auth,
      gate,
      handle((req, a) =>
        deps.service.commitPlans(a, commitPlansInputSchema.parse(req.body)),
      ),
    );
    router.get(
      `${prefix}/leg-seasons/:legId/:year`,
      auth,
      gate,
      handle((req, a) =>
        deps.service.readSeason(
          String(req.params.legId),
          year.parse(req.params.year),
          a,
        ),
      ),
    );
    router.patch(
      `${prefix}/leg-seasons/:legId/:year`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(legSeasonPlanInputSchema).parse(req.body);
        if (
          p.payload.legId !== req.params.legId ||
          p.payload.seasonYear !== year.parse(req.params.year)
        )
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.saveSeason(a, p);
      }),
    );
    router.get(
      `${prefix}/crew-availability`,
      auth,
      gate,
      handle((_req, a) => deps.service.listAvailability(a)),
    );
    router.post(
      `${prefix}/crew-availability`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(crewAvailabilityInputSchema).parse(
          req.body,
        );
        if (p.payload.id !== null)
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.saveAvailability(a, p);
      }),
    );
    router.patch(
      `${prefix}/crew-availability/:id`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(crewAvailabilityInputSchema).parse(
          req.body,
        );
        if (p.payload.id !== req.params.id)
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.saveAvailability(a, p);
      }),
    );
    if (role === "owner") {
      router.get(
        "/package-sets",
        auth,
        gate,
        handle((_req, a) => deps.service.listPackageSets(a)),
      );
      router.post(
        "/package-sets",
        auth,
        gate,
        handle((req, a) => {
          const p = revisionWriteSchema(packageSetInputSchema).parse(req.body);
          if (p.payload.id !== null)
            throw new PlanningError(400, "IDENTITY_MISMATCH");
          return deps.service.savePackageSet(a, p);
        }),
      );
      router.patch(
        "/package-sets/:id",
        auth,
        gate,
        handle((req, a) => {
          const p = revisionWriteSchema(packageSetInputSchema).parse(req.body);
          if (p.payload.id !== req.params.id)
            throw new PlanningError(400, "IDENTITY_MISMATCH");
          return deps.service.savePackageSet(a, p);
        }),
      );
      router.get(
        "/leg-planning/dave-authority",
        auth,
        gate,
        handle((_req, a) => deps.service.readDaveAuthority(a)),
      );
      router.patch(
        "/leg-planning/dave-authority",
        auth,
        gate,
        handle((req, a) =>
          deps.service.saveDaveAuthority(
            a,
            revisionWriteSchema(daveAuthorityInputSchema).parse(req.body),
          ),
        ),
      );
    }
    router.post(
      `${prefix}/leg-splits`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(splitGroupInputSchema).parse(req.body);
        if (p.payload.id !== null)
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.saveSplit(a, p);
      }),
    );
    router.patch(
      `${prefix}/leg-splits/:id`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(splitGroupInputSchema).parse(req.body);
        if (p.payload.id !== req.params.id)
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.saveSplit(a, p);
      }),
    );
    router.get(
      `${prefix}/leg-approvals`,
      auth,
      gate,
      handle((req, a) => {
        if (req.query.requestId && !id.safeParse(req.query.requestId).success)
          throw new PlanningError(400, "INVALID_ID");
        return deps.service.listApprovals(
          a,
          typeof req.query.requestId === "string"
            ? req.query.requestId
            : undefined,
        );
      }),
    );
    router.post(
      `${prefix}/leg-approvals`,
      auth,
      gate,
      handle((req, a) =>
        deps.service.requestApproval(
          a,
          revisionWriteSchema(approvalRequestInputSchema).parse(req.body),
        ),
      ),
    );
    router.post(
      `${prefix}/leg-approvals/:id/decision`,
      auth,
      gate,
      handle((req, a) => {
        const p = revisionWriteSchema(decisionWriteInputSchema).parse(req.body);
        if (p.payload.requestId !== req.params.id)
          throw new PlanningError(400, "IDENTITY_MISMATCH");
        return deps.service.decideApproval(a, p);
      }),
    );
  }
  router.use(((error, req, res, _next) => {
    if (error && typeof error === "object" && "issues" in error) {
      res
        .status(400)
        .json({
          code: "INVALID_INPUT",
          error: "Check the required fields and record identities.",
        });
      return;
    }
    if (error instanceof PlanningError) {
      res
        .status(error.status)
        .json({
          code: error.code,
          error: req.path.startsWith("/manager/")
            ? "The plan needs review or you do not have access to this record."
            : error.message,
        });
      return;
    }
    res
      .status(503)
      .json({
        code: "PLANNING_UNAVAILABLE",
        error:
          "Planning records are unavailable. Retry after the schema and sources are restored.",
      });
  }) as ErrorRequestHandler);
  return router;
}
