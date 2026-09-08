import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleOfficeAccountRepository } from "@/features/office/office-account-repository";
import { createRequireOfficeMiddleware } from "@/features/office/office-middleware";
import { createBusinessDocumentsRouter } from "./business-documents";

const router: IRouter = Router();
const requireOffice = createRequireOfficeMiddleware(new DrizzleOfficeAccountRepository(db));

router.use("/office", requireOffice, createBusinessDocumentsRouter());

export default router;
