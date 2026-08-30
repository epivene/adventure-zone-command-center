import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireOwnerMiddleware } from "./lib/auth";
import followUpsRouter from "./routes/follow-ups";
import assistantExistingProfileUpsertRouter from "./routes/assistant-existing-profile-upsert";
import assistantImportRouter from "./routes/assistant-import";
import assistantProfileFollowUpsRouter from "./routes/assistant-profile-followups";
import assistantProfileHistoryRouter from "./routes/assistant-profile-history";
import assistantProfileIntegrityRouter from "./routes/assistant-profile-integrity";
import assistantOfficeTasksRouter from "./routes/assistant-office-tasks";
import assistantTodayFollowUpsRouter from "./routes/assistant-today-followups";
import assistantProfileNotesRouter from "./routes/assistant-profile-notes";
import organizationFillerRouter from "./routes/organization-filler";

const app: Express = express();

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

app.use(
  cors({
    origin: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/assistant-import", assistantProfileHistoryRouter);
app.use("/api/assistant-import", assistantProfileIntegrityRouter);
app.use("/api/assistant-import", assistantOfficeTasksRouter);
app.use("/api/assistant-import", assistantProfileFollowUpsRouter);
app.use("/api/assistant-import", assistantTodayFollowUpsRouter);
app.use("/api/assistant-import", assistantProfileNotesRouter);
app.use("/api/assistant-import", assistantExistingProfileUpsertRouter);
app.use("/api/assistant-import", assistantImportRouter);
app.use("/api/follow-ups", requireOwnerMiddleware, followUpsRouter);
app.use("/api", organizationFillerRouter);
app.use("/api", router);

export default app;
