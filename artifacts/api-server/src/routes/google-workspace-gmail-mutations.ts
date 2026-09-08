import { Router, type IRouter } from "express";
import { z } from "zod";

import { GoogleReviewProfileAssignmentService } from "@/features/google-workspace/google-review-profile-assignment-service";
import type { GoogleProfileLabelSyncResult } from "@/features/google-workspace/google-profile-label-sync-service";

const paramsSchema = z.object({
  mutationId: z.string().uuid(),
});

function safeError(error: unknown): string {
  return error instanceof Error && error.message.startsWith("GOOGLE_WORKSPACE_")
    ? error.message
    : "GOOGLE_WORKSPACE_GMAIL_MUTATION_FAILED";
}

function status(code: string): number {
  if (code === "GOOGLE_WORKSPACE_GMAIL_MUTATION_NOT_FOUND") return 404;
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED" ||
    code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED" ||
    code === "GOOGLE_WORKSPACE_CONNECTION_CHANGED"
  ) return 409;
  return 500;
}

export function createGoogleWorkspaceGmailMutationsRouter(options?: {
  retry?(mutationId: string): Promise<GoogleProfileLabelSyncResult>;
}): IRouter {
  const router: IRouter = Router();
  const assignment = new GoogleReviewProfileAssignmentService();
  const retry = options?.retry ??
    assignment.retryGmailMutation.bind(assignment);

  router.post(
    "/google-workspace/gmail-mutations/:mutationId/retry",
    async (req, res): Promise<void> => {
      const parsed = paramsSchema.safeParse(req.params);
      if (!parsed.success) {
        res.status(400).json({
          error: "GOOGLE_WORKSPACE_GMAIL_MUTATION_ID_INVALID",
        });
        return;
      }
      try {
        res.json({
          ok: true,
          gmailSync: await retry(parsed.data.mutationId),
        });
      } catch (error) {
        const code = safeError(error);
        res.status(status(code)).json({ error: code });
      }
    },
  );

  return router;
}

export default createGoogleWorkspaceGmailMutationsRouter();
