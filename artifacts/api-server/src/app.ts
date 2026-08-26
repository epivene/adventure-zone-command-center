import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { requireOwnerMiddleware } from "./lib/auth";
import followUpsRouter from "./routes/follow-ups";
import assistantImportRouter from "./routes/assistant-import";
import assistantProfileHistoryRouter from "./routes/assistant-profile-history";

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

// Allow the static frontend (different origin on Render) to call the API
// with the Authorization bearer header.
app.use(
  cors({
    origin: true,
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
// Profile photos are compressed client-side and the photo route has its own
// stricter 750 KB data-URL validation. Keep the general JSON ceiling just
// above that so a valid shared profile image reaches the route for validation.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api/assistant-import", assistantProfileHistoryRouter);
app.use("/api/assistant-import", assistantImportRouter);
app.use("/api/follow-ups", requireOwnerMiddleware, followUpsRouter);
app.use("/api", router);

export default app;
