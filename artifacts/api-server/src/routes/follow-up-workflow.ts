import {
  Router,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { ZodError } from "zod";
import type { FollowUpWorkflow } from "../features/follow-ups/workflow-service";
import { WorkflowError } from "../features/follow-ups/workflow-types";
import type {
  readComDraftContext,
  previewComDraft,
} from "../features/follow-ups/com-draft-context";

// Mounted after the owner's authentication gate in routes/index.ts.
export function createFollowUpWorkflowRouter(
  workflow: FollowUpWorkflow,
  requireOwner: RequestHandler,
  draftContext?: (input: unknown) => ReturnType<typeof readComDraftContext>,
  draftPreview?: (input: unknown) => ReturnType<typeof previewComDraft>,
) {
  const router = Router();
  router.use(requireOwner);
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  const run =
    (action: (req: Request) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      try {
        res.json(await action(req));
      } catch (error) {
        if (error instanceof WorkflowError) {
          res
            .status(error.status)
            .json({ error: error.message, code: error.code });
          return;
        }
        if (error instanceof ZodError) {
          res.status(400).json({
            error: "Review the work queue filters.",
            code: "INVALID_INPUT",
          });
          return;
        }
        req.log?.error({ error }, "Follow-up workflow failed");
        res.status(500).json({
          error:
            "Could not save or load follow-up work. Refresh before retrying.",
        });
      }
    };
  router.get(
    "/work-queue",
    run((req) => workflow.list(req.query)),
  );
  router.get(
    "/work-queue/opportunity/:id",
    run((req) => workflow.inspectOpportunity(req.params.id)),
  );
  router.post(
    "/follow-ups/:id/snooze",
    run((req) => workflow.snooze({ ...req.body, id: req.params.id })),
  );
  router.post(
    "/follow-ups/:id/resolve",
    run((req) => workflow.resolve({ ...req.body, id: req.params.id })),
  );
  router.post(
    "/work-queue/plan",
    run((req) => workflow.plan(req.body)),
  );
  router.post(
    "/work-queue/decide",
    run((req) => workflow.decide(req.body)),
  );
  if (draftContext) {
    router.get(
      "/profiles/:id/draft-context",
      run((req) => draftContext({ ...req.query, profileId: req.params.id })),
    );
    // External COM generates personalization. This endpoint only assembles the
    // approved HTML and bounded source context; it never launches an app agent.
    router.post(
      "/com/draft-context",
      run((req) => draftContext(req.body)),
    );
  }
  if (draftPreview)
    router.post(
      "/com/draft-preview",
      run((req) => draftPreview(req.body)),
    );
  return router;
}
