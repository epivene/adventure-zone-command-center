import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { createDefaultInvoicesRouter } from "./invoices-runtime";
import { DrizzleContractQueryRepository } from "@/features/contracts/contract-query-repository";
import { createContractWorkspaceReadRouter } from "./contract-workspace-read";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));
router.use("/office", requireOffice, createDefaultInvoicesRouter(), createContractWorkspaceReadRouter(new DrizzleContractQueryRepository(db)));
export default router;
