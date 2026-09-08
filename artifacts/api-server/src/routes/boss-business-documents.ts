import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleBossAccountRepository } from "@/features/boss/boss-account-repository";
import { createRequireBossMiddleware } from "@/features/boss/boss-middleware";
import { createBusinessDocumentsRouter } from "./business-documents";

const router: IRouter = Router();
const requireBoss = createRequireBossMiddleware(new DrizzleBossAccountRepository(db));

router.use("/boss", requireBoss, createBusinessDocumentsRouter());

export default router;
