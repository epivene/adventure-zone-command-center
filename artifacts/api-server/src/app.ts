import { mountChatGPTConnection } from "./features/chatgpt-connection/connection-runtime";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireOwnerMiddleware } from "./lib/auth";
import followUpsRouter from "./routes/follow-ups";
import assistantImportRouter from "./routes/assistant-import";
import assistantProfileHistoryRouter from "./routes/assistant-profile-history";
import assistantProfileIntegrityRouter from "./routes/assistant-profile-integrity";
import assistantOfficeTasksRouter from "./routes/assistant-office-tasks";
import assistantTodayFollowUpsRouter from "./routes/assistant-today-followups";
import assistantProfileNotesRouter from "./routes/assistant-profile-notes";
import assistantGmailProfileLinksRouter from "./routes/assistant-gmail-profile-links";
import assistantManagerReviewAuditRouter from "./routes/assistant-manager-review-audit";
import assistantKristyReviewCorrectionRouter from "./routes/assistant-kristy-review-correction";
import assistantBlandingKristyCorrectionRouter from "./routes/assistant-blanding-kristy-correction";
import managerReviewOverviewRouter from "./routes/manager-review-overview";
import organizationFillerRouter from "./routes/organization-filler";
import { requireStartupReadiness } from "./lib/startup-readiness";
import {
  createWebsiteInquiryCorsMiddleware,
  websiteInquiryBodyErrorHandler,
  websiteInquiryJsonParser,
} from "./routes/public-website-inquiries";

const app: Express = express();
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(requireStartupReadiness);
mountChatGPTConnection(app);

app.use(
  "/api/public/website-inquiries",
  createWebsiteInquiryCorsMiddleware(),
  websiteInquiryJsonParser,
  websiteInquiryBodyErrorHandler,
);

app.use(
  cors({
    origin: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-File-Name",
      "X-Document-Name",
      "X-Document-Category",
    ],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/assistant-import", assistantProfileHistoryRouter);
app.use("/api/assistant-import", assistantProfileIntegrityRouter);
app.use("/api/assistant-import", assistantOfficeTasksRouter);
app.use("/api/assistant-import", assistantTodayFollowUpsRouter);
app.use("/api/assistant-import", assistantProfileNotesRouter);
app.use("/api/assistant-import", assistantGmailProfileLinksRouter);
app.use("/api/assistant-import", assistantManagerReviewAuditRouter);
app.use("/api/assistant-import", assistantKristyReviewCorrectionRouter);
app.use("/api/assistant-import", assistantBlandingKristyCorrectionRouter);
app.use("/api/assistant-import", assistantImportRouter);
app.use("/api/follow-ups", requireOwnerMiddleware, followUpsRouter);
app.use("/api", managerReviewOverviewRouter);
app.use("/api", organizationFillerRouter);
app.use("/api", router);

export default app;
