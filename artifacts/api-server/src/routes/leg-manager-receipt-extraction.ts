import express, { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { DrizzleLegManagerRepository } from "@/features/leg-manager/leg-manager-repository";
import { createRequireLegManagerMiddleware } from "@/features/leg-manager/leg-manager-middleware";
import { extractReceiptFields } from "@/features/leg-manager/receipt-extraction";

const router: IRouter = Router();
const requireManager = createRequireLegManagerMiddleware(new DrizzleLegManagerRepository(db));

router.post(
  "/manager/receipts/extract",
  requireManager,
  express.raw({ type: "image/*", limit: "12mb" }),
  async (req, res): Promise<void> => {
    const bytes = req.body instanceof Buffer ? new Uint8Array(req.body) : new Uint8Array();
    if (!bytes.length) {
      res.status(400).json({ error: "Receipt image is required" });
      return;
    }
    const header = req.headers["content-type"];
    const mimeType = Array.isArray(header) ? header[0] ?? "image/jpeg" : header ?? "image/jpeg";
    res.json(await extractReceiptFields({ bytes, mimeType }));
  },
);

export default router;
