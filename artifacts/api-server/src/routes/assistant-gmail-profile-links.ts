import { Router, type IRouter } from "express";
import { z } from "zod";

import {
  GoogleSentProfileLinkSweepService,
  type GoogleSentProfileLinkSweepResult,
} from "@/features/google-workspace/google-sent-profile-link-sweep-service";
import {
  PostgresGoogleValidationRepository,
  type GoogleApprovedValidationMapping,
  type GoogleValidationMappingInput,
} from "@/features/google-workspace/google-validation-repository";
import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";

const sweepInputSchema = z.object({
  after: z.string().datetime({ offset: true }),
  before: z.string().datetime({ offset: true }),
  repair: z.boolean().optional().default(false),
}).strict();

const profileIdSchema = z.string().uuid();
const gmailIdSchema = z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/);
const linkInputSchema = z.object({
  threadId: gmailIdSchema,
}).strict();

type SweepAccess = {
  run(input: {
    after: Date;
    before: Date;
    repair: boolean;
  }): Promise<GoogleSentProfileLinkSweepResult>;
};

type ValidationAccess = {
  upsertRows(rows: GoogleValidationMappingInput[]): Promise<void>;
  listApprovedForOrganization(
    organizationId: string,
  ): Promise<GoogleApprovedValidationMapping[]>;
};

function statusFor(error: unknown): number {
  const code = error instanceof Error ? error.message : "";
  if (
    code === "GOOGLE_WORKSPACE_SENT_PROFILE_LINK_WINDOW_INVALID"
    || code === "GOOGLE_WORKSPACE_SENT_PROFILE_LINK_WINDOW_TOO_LARGE"
  ) {
    return 400;
  }
  if (
    code === "GOOGLE_WORKSPACE_NOT_CONNECTED"
    || code === "GOOGLE_WORKSPACE_REAUTHORIZATION_REQUIRED"
    || code === "GOOGLE_WORKSPACE_NOT_AUTHENTICATED"
  ) {
    return 409;
  }
  if (code === "GOOGLE_WORKSPACE_SENT_PROFILE_LINK_UNAVAILABLE") {
    return 503;
  }
  return 500;
}

function publicError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  return code.startsWith("GOOGLE_WORKSPACE_")
    ? code
    : "GOOGLE_WORKSPACE_SENT_PROFILE_LINK_SWEEP_FAILED";
}

export function createAssistantGmailProfileLinksRouter(options?: {
  sweep?: SweepAccess;
  validation?: ValidationAccess;
}): IRouter {
  const router: IRouter = Router();
  const sweep = options?.sweep ?? new GoogleSentProfileLinkSweepService();
  const validation = options?.validation ?? new PostgresGoogleValidationRepository();

  router.use(requireAssistantImportToken);

  router.post("/gmail-profile-links/sweep", async (req, res): Promise<void> => {
    const parsed = sweepInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        ok: false,
        error: "GOOGLE_WORKSPACE_SENT_PROFILE_LINK_INPUT_INVALID",
      });
      return;
    }

    try {
      const result = await sweep.run({
        after: new Date(parsed.data.after),
        before: new Date(parsed.data.before),
        repair: parsed.data.repair,
      });
      res.json({ ok: true, ...result });
    } catch (error) {
      req.log?.error?.({ err: error }, "Sent Gmail profile-link sweep failed");
      res.status(statusFor(error)).json({
        ok: false,
        error: publicError(error),
      });
    }
  });

  router.put(
    "/gmail-profile-links/profile/:organizationId/messages/:messageId",
    async (req, res): Promise<void> => {
      const profileId = profileIdSchema.safeParse(req.params.organizationId);
      const messageId = gmailIdSchema.safeParse(req.params.messageId);
      const input = linkInputSchema.safeParse(req.body);
      if (!profileId.success || !messageId.success || !input.success) {
        res.status(400).json({
          ok: false,
          error: "GOOGLE_WORKSPACE_PROFILE_LINK_INPUT_INVALID",
        });
        return;
      }

      try {
        await validation.upsertRows([{
          messageId: messageId.data,
          threadId: input.data.threadId,
          organizationId: profileId.data,
          contactId: null,
          evidenceCodes: ["assistant_approved_gmail_profile_link"],
        }]);
        res.json({
          ok: true,
          organizationId: profileId.data,
          messageId: messageId.data,
          threadId: input.data.threadId,
        });
      } catch (error) {
        req.log?.error?.(
          { err: error, organizationId: profileId.data, messageId: messageId.data },
          "Gmail message could not be linked to profile",
        );
        res.status(statusFor(error)).json({
          ok: false,
          error: publicError(error),
        });
      }
    },
  );

  router.get(
    "/gmail-profile-links/profile/:organizationId",
    async (req, res): Promise<void> => {
      const parsed = profileIdSchema.safeParse(req.params.organizationId);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          error: "GOOGLE_WORKSPACE_PROFILE_ID_INVALID",
        });
        return;
      }

      try {
        const mappings = await validation.listApprovedForOrganization(parsed.data);
        res.json({
          ok: true,
          organizationId: parsed.data,
          mappings,
        });
      } catch (error) {
        req.log?.error?.(
          { err: error, organizationId: parsed.data },
          "Approved Gmail profile mappings could not be listed",
        );
        res.status(statusFor(error)).json({
          ok: false,
          error: publicError(error),
        });
      }
    },
  );

  return router;
}

export default createAssistantGmailProfileLinksRouter();
