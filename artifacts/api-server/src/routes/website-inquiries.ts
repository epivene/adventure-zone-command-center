import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";

import { db } from "@workspace/db";
import { createWebsiteInquiryAuthorization } from "../features/website-inquiries/website-inquiry-authorization";
import {
  DrizzleWebsiteInquiryConversionRepository,
  WebsiteInquiryConversionNotFoundError,
  websiteInquiryConversionSchema,
  WebsiteInquiryConversionService,
  WebsiteInquiryConversionStatusError,
} from "../features/website-inquiries/website-inquiry-conversion";
import { DrizzleWebsiteInquiryMatchRepository } from "../features/website-inquiries/website-inquiry-match-repository";
import { WebsiteInquiryMatchingService } from "../features/website-inquiries/website-inquiry-matching";
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
const searchSchema = z
  .object({
    entity: z.enum(["contact", "organization"]),
    q: z.string().trim().min(2).max(160),
  })
  .strict();

type ReviewService = Pick<
  WebsiteInquiryReviewService,
  "list" | "count" | "detail" | "changeStatus"
> &
  Pick<WebsiteInquiryMatchingService, "matches" | "search"> &
  Pick<WebsiteInquiryConversionService, "convert">;

function routeError(error: unknown, res: Parameters<RequestHandler>[1]): void {
  if (
    error instanceof WebsiteInquiryNotFoundError ||
    error instanceof WebsiteInquiryConversionNotFoundError
  ) {
    res.status(404).json({ error: error.message });
    return;
  }
  if (
    error instanceof WebsiteInquiryTransitionError ||
    error instanceof WebsiteInquiryConversionStatusError
  ) {
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

  router.get("/website-inquiries/search", async (req, res) => {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid inquiry search request." });
      return;
    }
    try {
      res.json(
        await input.service.search({
          entity: parsed.data.entity,
          query: parsed.data.q,
        }),
      );
    } catch (error) {
      routeError(error, res);
    }
  });

  router.get("/website-inquiries/:inquiryId/matches", async (req, res) => {
    const parsed = inquiryIdSchema.safeParse(req.params.inquiryId);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid inquiry ID." });
      return;
    }
    try {
      res.json(await input.service.matches(parsed.data));
    } catch (error) {
      routeError(error, res);
    }
  });

  router.post("/website-inquiries/:inquiryId/convert", async (req, res) => {
    const parsedId = inquiryIdSchema.safeParse(req.params.inquiryId);
    const parsedBody = websiteInquiryConversionSchema.safeParse(req.body);
    if (!parsedId.success || !parsedBody.success) {
      res.status(400).json({ error: "Invalid inquiry conversion request." });
      return;
    }
    try {
      res.json(
        await input.service.convert({
          inquiryId: parsedId.data,
          input: parsedBody.data,
          actor: req.websiteInquiryActor!,
        }),
      );
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
const reviewService = new WebsiteInquiryReviewService({ repository });
const matchingService = new WebsiteInquiryMatchingService(
  new DrizzleWebsiteInquiryMatchRepository(db),
);
const conversionService = new WebsiteInquiryConversionService({
  repository: new DrizzleWebsiteInquiryConversionRepository(db),
});
const router = createWebsiteInquiriesRouter({
  authorize: createWebsiteInquiryAuthorization(),
  service: {
    list: (input) => reviewService.list(input),
    count: () => reviewService.count(),
    detail: (inquiryId) => reviewService.detail(inquiryId),
    changeStatus: (input) => reviewService.changeStatus(input),
    matches: (inquiryId) => matchingService.matches(inquiryId),
    search: (input) => matchingService.search(input),
    convert: (input) => conversionService.convert(input),
  },
});

export default router;
