import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { createWebsiteInquiryAuthorization } from "../features/website-inquiries/website-inquiry-authorization";
import { DrizzleWebsiteInquiryRepository } from "../features/website-inquiries/website-inquiry-repository";
import {
  parseWebsiteInquiryCursor,
  WebsiteInquiryNotFoundError,
  WebsiteInquiryReviewService,
  WebsiteInquiryTransitionError,
} from "../features/website-inquiries/website-inquiry-review-service";

const statusSchema = z.enum([
  "new",
  "reviewing",
  "converted",
  "archived",
  "spam",
]);
const listSchema = z
  .object({
    status: statusSchema.optional(),
    cursor: z
      .string()
      .refine((value) => parseWebsiteInquiryCursor(value) !== null)
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();
const inquiryIdSchema = z.string().uuid();
const statusActionSchema = z
  .object({
    action: z.enum(["begin_review", "archive", "spam", "restore"]),
  })
  .strict();

type ReviewService = Pick<
  WebsiteInquiryReviewService,
  "list" | "count" | "detail" | "changeStatus"
>;

function routeError(error: unknown, res: Parameters<RequestHandler>[1]): void {
  if (error instanceof WebsiteInquiryNotFoundError) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (error instanceof WebsiteInquiryTransitionError) {
    res.status(409).json({ error: error.message });
    return;
  }
  res.status(500).json({ error: "Website inquiry request failed." });
}

export function createWebsiteInquiriesRouter(input: {
  authorize: RequestHandler;
  service: ReviewService;
}): IRouter {
  const router: IRouter = Router();
  router.use("/website-inquiries", input.authorize);

  router.get("/website-inquiries/count", async (_req, res) => {
    try {
      res.json(await input.service.count());
    } catch (error) {
      routeError(error, res);
    }
  });

  router.get("/website-inquiries", async (req, res) => {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid inquiry list request." });
      return;
    }
    try {
      res.json(await input.service.list(parsed.data));
    } catch (error) {
      routeError(error, res);
    }
  });

  router.get("/website-inquiries/:inquiryId", async (req, res) => {
    const parsed = inquiryIdSchema.safeParse(req.params.inquiryId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid inquiry ID." });
      return;
    }
    try {
      res.json(await input.service.detail(parsed.data));
    } catch (error) {
      routeError(error, res);
    }
  });

  router.patch("/website-inquiries/:inquiryId/status", async (req, res) => {
    const parsedId = inquiryIdSchema.safeParse(req.params.inquiryId);
    const parsedBody = statusActionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      res.status(400).json({ error: "Invalid inquiry status request." });
      return;
    }
    try {
      res.json(
        await input.service.changeStatus({
          inquiryId: parsedId.data,
          action: parsedBody.data.action,
          actor: req.websiteInquiryActor!,
        }),
      );
    } catch (error) {
      routeError(error, res);
    }
  });

  return router;
}

const repository = new DrizzleWebsiteInquiryRepository(db);
const router = createWebsiteInquiriesRouter({
  authorize: createWebsiteInquiryAuthorization(),
  service: new WebsiteInquiryReviewService({ repository }),
});

export default router;
