import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { createDefaultInvoicesRouter } from "./invoices-runtime";
import { DrizzleContractQueryRepository } from "@/features/contracts/contract-query-repository";
import { createContractWorkspaceReadRouter } from "./contract-workspace-read";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));
router.use("/boss", requireBoss, createDefaultInvoicesRouter(), createContractWorkspaceReadRouter(new DrizzleContractQueryRepository(db)));
export default router;
