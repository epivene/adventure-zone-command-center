import { Router, type IRouter } from "express";

import {
  createProductionOpportunityEmailRuntime,
  getProductionOpportunityEmailRuntime,
} from "@/features/opportunity-email/production-opportunity-email-runtime";
import { createOpportunityEmailRuntimeRouter } from "./opportunity-email-runtime";

type ProductionRuntime = Awaited<ReturnType<typeof createProductionOpportunityEmailRuntime>>;
type RouteRuntime = Pick<ProductionRuntime, "drafts" | "readyToSend">;
type LoadRuntime = () => Promise<RouteRuntime>;

export function createLazyOpportunityEmailRuntimeRouter(
  loadRuntime: LoadRuntime,
): IRouter {
  const router: IRouter = Router();
  let runtimeRouterPromise: Promise<IRouter> | null = null;

  const loadRouter = () => {
    runtimeRouterPromise ??= loadRuntime()
      .then((runtime) => createOpportunityEmailRuntimeRouter({
        drafts: runtime.drafts,
        readyToSend: runtime.readyToSend,
      }))
      .catch((error) => {
        runtimeRouterPromise = null;
        throw error;
      });
    return runtimeRouterPromise;
  };

  router.use(async (req, res, next) => {
    try {
      const runtimeRouter = await loadRouter();
      runtimeRouter(req, res, next);
    } catch (error) {
      req.log?.error?.({
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String((error as { code?: unknown }).code)
            : "unknown",
      }, "Opportunity email runtime unavailable");
      if (!res.headersSent) {
        res.status(503).json({ error: "OPPORTUNITY_EMAIL_RUNTIME_UNAVAILABLE" });
      }
    }
  });

  return router;
}

const opportunityEmailLiveRuntimeRouter = createLazyOpportunityEmailRuntimeRouter(
  getProductionOpportunityEmailRuntime,
);

export default opportunityEmailLiveRuntimeRouter;
