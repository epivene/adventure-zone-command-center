import { randomUUID } from "node:crypto";

import cors from "cors";
import express, {
  Router,
  type ErrorRequestHandler,
  type IRouter,
  type RequestHandler,
} from "express";
import { db } from "@workspace/db";

import { websiteInquirySubmissionSchema } from "@/features/website-inquiries/public-contract";
import {
  FixedWindowInquiryRateLimiter,
  InquiryOriginError,
  assertAllowedInquiryPage,
  readWebsiteInquiryAllowedOrigins,
} from "@/features/website-inquiries/public-security";
import { DrizzleWebsiteInquiryRepository } from "@/features/website-inquiries/website-inquiry-repository";
import { WebsiteInquiryIntakeService } from "@/features/website-inquiries/website-inquiry-service";

type InquiryService = Pick<WebsiteInquiryIntakeService, "createInquiry">;
type InquiryLimiter = Pick<FixedWindowInquiryRateLimiter, "consume">;

function defaultAllowedOrigins(): ReadonlySet<string> {
  try {
    return readWebsiteInquiryAllowedOrigins(process.env, process.env.NODE_ENV);
  } catch {
    return new Set();
  }
}

function defaultLimiter(): FixedWindowInquiryRateLimiter {
  return new FixedWindowInquiryRateLimiter({
    limit: 5,
    windowMs: 15 * 60_000,
    secret:
      process.env.WEBSITE_INQUIRY_RATE_LIMIT_SECRET ??
      process.env.SESSION_SECRET ??
      randomUUID(),
  });
}

export const websiteInquiryJsonParser = express.json({
  limit: "16kb",
  strict: true,
});

export const websiteInquiryBodyErrorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  next,
) => {
  const type = (error as { type?: string }).type;
  if (type === "entity.too.large") {
    res.status(413).json({ error: "That inquiry is too large to send." });
    return;
  }
  if (error instanceof SyntaxError) {
    res.status(400).json({ error: "Review the inquiry details and try again." });
    return;
  }
  next(error);
};

export function createWebsiteInquiryCorsMiddleware(
  allowedOrigins: ReadonlySet<string> = defaultAllowedOrigins(),
): RequestHandler {
  const corsMiddleware = cors({
    origin: true,
    allowedHeaders: ["Content-Type"],
    methods: ["POST", "OPTIONS"],
  });

  return (req, res, next) => {
    const origin = req.get("Origin");
    if (!origin || !allowedOrigins.has(origin)) {
      res.status(403).json({ error: "This form cannot be submitted here." });
      return;
    }
    corsMiddleware(req, res, next);
  };
}

export function createPublicWebsiteInquiriesRouter(dependencies?: {
  service?: InquiryService;
  allowedOrigins?: ReadonlySet<string>;
  limiter?: InquiryLimiter;
}): IRouter {
  const router: IRouter = Router();
  const allowedOrigins = dependencies?.allowedOrigins ?? defaultAllowedOrigins();
  const limiter = dependencies?.limiter ?? defaultLimiter();
  const service =
    dependencies?.service ??
    new WebsiteInquiryIntakeService({
      repository: new DrizzleWebsiteInquiryRepository(db),
    });

  router.post("/public/website-inquiries", async (req, res): Promise<void> => {
    const rate = limiter.consume(req.ip || req.socket.remoteAddress || "unknown");
    if (!rate.allowed) {
      res.set("Retry-After", String(rate.retryAfterSeconds));
      res.status(429).json({ error: "Please wait a moment and try again." });
      return;
    }

    const parsed = websiteInquirySubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Review the inquiry details and try again." });
      return;
    }

    try {
      const { origin } = assertAllowedInquiryPage(
        req.get("Origin"),
        parsed.data.pageUrl,
        allowedOrigins,
      );
      const result = await service.createInquiry(parsed.data, origin);
      res.status(result.duplicate ? 200 : 201).json({
        referenceCode: result.referenceCode,
        message: "Your inquiry was received. Our booking team will follow up.",
      });
    } catch (error) {
      if (error instanceof InquiryOriginError) {
        res.status(403).json({ error: "This form cannot be submitted here." });
        return;
      }
      req.log?.error(
        { err: error instanceof Error ? error.name : "unknown" },
        "Failed to save website inquiry",
      );
      res.status(503).json({
        error: "We could not save your inquiry right now. Please try again.",
      });
    }
  });

  return router;
}

export default createPublicWebsiteInquiriesRouter();
