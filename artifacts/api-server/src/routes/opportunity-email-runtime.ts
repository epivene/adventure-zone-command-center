import { Router, type IRouter } from "express";

import { createOpportunityDraftsRouter, type OpportunityDraftRouteService } from "./opportunity-drafts";
import { createTodayReadyToSendRouter, type TodayReadyToSendRouteService } from "./today-ready-to-send";

export type OpportunityEmailRuntimeRouteServices = {
  drafts: OpportunityDraftRouteService;
  readyToSend: TodayReadyToSendRouteService;
};

export function createOpportunityEmailRuntimeRouter(
  services: OpportunityEmailRuntimeRouteServices,
): IRouter {
  const router: IRouter = Router();
  router.use("/opportunities", createOpportunityDraftsRouter(services.drafts));
  router.use("/today/ready-to-send", createTodayReadyToSendRouter(services.readyToSend));
  return router;
}
