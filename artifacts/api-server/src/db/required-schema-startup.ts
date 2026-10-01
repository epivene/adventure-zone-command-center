import { ensureBookingWorkSchemaBeforeListen } from "./booking-work-required-startup";
import { ensureChatGPTConnectionSchemaBeforeListen } from "./chatgpt-connection-required-startup";
import { runStartupStep } from "../lib/startup-step";
import { ensureEventReviewDismissalSchemaBeforeListen } from "./event-review-dismissal-required-startup";
import { ensureFollowUpDismissalPersistenceBeforeListen } from "./follow-up-dismissal-required-startup";
import { ensureGoogleWorkspaceSchemaBeforeListen } from "./google-workspace-required-startup";
import { ensureLeadIntakeSchemaBeforeListen } from "./lead-intake-required-startup";
import { ensureLegAssignmentSchemaBeforeListen } from "./leg-assignment-required-startup";
import { ensureOfficeCoordinatorSchemaBeforeListen } from "./office-coordinator-required-startup";
import { ensureBossSchemaBeforeListen } from "./boss-required-startup";
import { ensureWebsiteInquirySchemaBeforeListen } from "./website-inquiry-required-startup";
import { ensureOrganizerFeedbackSchemaBeforeListen } from "./organizer-feedback-required-startup";
import { ensureComputerCallingSchemaBeforeListen } from "./computer-calling-required-startup";
import { ensureInboundCallingSchemaBeforeListen } from "./inbound-calling-required-startup";
import { ensurePaperNotesSchemaBeforeListen } from "./paper-notes-required-startup";
import { ensureProfileTouchSchema } from "../features/organizations/profile-touch-schema";
import { ensureDesignStudioSchemaBeforeListen } from "./design-studio-required-startup";
import { ensureProfileFillerSchemaBeforeListen } from "./profile-filler-required-startup";
import { ensureBusinessDocumentSchemaBeforeListen } from "./business-document-required-startup";
import { ensureGoogleDriveBackupSchemaBeforeListen } from "./google-drive-backup-required-startup";
import { ensureCommunicationTemplateReviewSetSchemaBeforeListen } from "./communication-template-review-set-required-startup";
import { ensureYearEndInspectionSchemaBeforeListen } from "./year-end-inspection-required-startup";

const REQUIRED_SCHEMA_TIMEOUT_MS = 120_000;
const REQUIRED_SCHEMA_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

type RequiredStep = () => Promise<unknown>;
type RequiredStepRunner = (
  name: string,
  step: RequiredStep,
  timeoutMs?: number,
  onTimeout?: (error: Error) => void,
) => Promise<unknown>;

function postgresErrorCode(error: unknown): string | null {
  return error && typeof error === "object" && "code" in error
    && typeof (error as { code?: unknown }).code === "string"
    ? (error as { code: string }).code
    : null;
}

function isTransientDatabaseStartupError(error: unknown): boolean {
  const code = postgresErrorCode(error);
  return code === "57P03"
    || code === "57P01"
    || code === "57P02"
    || code === "08000"
    || code === "08001"
    || code === "08003"
    || code === "08004"
    || code === "08006"
    || (error instanceof Error
      && /connection (?:terminated|closed) unexpectedly|econnreset/i.test(error.message));
}

function systemSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

export async function runRequiredSchemaStartup(dependencies?: {
  run?: RequiredStepRunner;
  ensureBookingWork?: RequiredStep;
  ensurePaperNotes?: RequiredStep;
  ensureGoogleWorkspace?: RequiredStep;
  ensureLeadIntake?: RequiredStep;
  ensureLegAssignment?: RequiredStep;
  ensureYearEndInspections?: RequiredStep;
  ensureEventReviewDismissals?: RequiredStep;
  ensureFollowUpDismissals?: RequiredStep;
  ensureOrganizerFeedback?: RequiredStep;
  ensureComputerCalling?: RequiredStep;
  ensureInboundCalling?: RequiredStep;
  ensureOfficeCoordinator?: RequiredStep;
  ensureBoss?: RequiredStep;
  ensureCommunicationTemplateReviewSets?: RequiredStep;
  ensureWebsiteInquiries?: RequiredStep;
  ensureProfileFiller?: RequiredStep;
  ensureProfileTouch?: RequiredStep;
  ensureDesignStudio?: RequiredStep;
  ensureBusinessDocuments?: RequiredStep;
  ensureGoogleDriveBackup?: RequiredStep;
  ensureChatGPTConnection?: RequiredStep;
  sleep?: (delayMs: number) => Promise<void>;
}): Promise<void> {
  const run = dependencies?.run ?? runStartupStep;
  const sleep = dependencies?.sleep ?? systemSleep;
  const runRequired = async (
    name: string,
    step: RequiredStep,
    onTimeout?: (error: Error) => void,
  ) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await run(name, step, REQUIRED_SCHEMA_TIMEOUT_MS, onTimeout);
      } catch (error) {
        const delayMs = REQUIRED_SCHEMA_RETRY_DELAYS_MS[attempt];
        if (!isTransientDatabaseStartupError(error) || delayMs === undefined) {
          throw error;
        }
        await sleep(delayMs);
      }
    }
  };
  await runRequired("required booking work schema", dependencies?.ensureBookingWork ?? ensureBookingWorkSchemaBeforeListen);
  if (process.env.CHATGPT_CONNECTION_ENABLED === "true" || dependencies?.ensureChatGPTConnection) {
    await runRequired("required ChatGPT connection schema", dependencies?.ensureChatGPTConnection ?? ensureChatGPTConnectionSchemaBeforeListen);
  }
  await runRequired(
    "required paper notes schema",
    dependencies?.ensurePaperNotes ?? ensurePaperNotesSchemaBeforeListen,
  );
  await runRequired("required inbound calling schema", dependencies?.ensureInboundCalling ?? ensureInboundCallingSchemaBeforeListen);
  await runRequired(
    "required Google Workspace schema",
    dependencies?.ensureGoogleWorkspace ?? ensureGoogleWorkspaceSchemaBeforeListen,
  );
  const leadIntakeAbortController = new AbortController();
  await runRequired(
    "required lead intake schema",
    dependencies?.ensureLeadIntake
      ?? (() => ensureLeadIntakeSchemaBeforeListen({
        signal: leadIntakeAbortController.signal,
      })),
    (error) => leadIntakeAbortController.abort(error),
  );
  await runRequired(
    "required leg assignment schema",
    dependencies?.ensureLegAssignment ?? ensureLegAssignmentSchemaBeforeListen,
  );
  await runRequired(
    "required year-end inspection schema",
    dependencies?.ensureYearEndInspections ?? ensureYearEndInspectionSchemaBeforeListen,
  );
  await runRequired(
    "required event review dismissal schema",
    dependencies?.ensureEventReviewDismissals ?? ensureEventReviewDismissalSchemaBeforeListen,
  );
  await runRequired(
    "required follow-up dismissal persistence",
    dependencies?.ensureFollowUpDismissals ?? ensureFollowUpDismissalPersistenceBeforeListen,
  );
  await runRequired(
    "required organizer feedback schema",
    dependencies?.ensureOrganizerFeedback ?? ensureOrganizerFeedbackSchemaBeforeListen,
  );
  await runRequired(
    "required computer calling schema",
    dependencies?.ensureComputerCalling ?? ensureComputerCallingSchemaBeforeListen,
  );
  await runRequired(
    "required office coordinator schema",
    dependencies?.ensureOfficeCoordinator ?? ensureOfficeCoordinatorSchemaBeforeListen,
  );
  await runRequired(
    "required Boss schema",
    dependencies?.ensureBoss ?? ensureBossSchemaBeforeListen,
  );
  await runRequired(
    "required communication template review-set schema",
    dependencies?.ensureCommunicationTemplateReviewSets
      ?? ensureCommunicationTemplateReviewSetSchemaBeforeListen,
  );
  await runRequired(
    "required website inquiry schema",
    dependencies?.ensureWebsiteInquiries ?? ensureWebsiteInquirySchemaBeforeListen,
  );
  await runRequired(
    "required profile filler schema",
    dependencies?.ensureProfileFiller ?? ensureProfileFillerSchemaBeforeListen,
  );
  await runRequired(
    "required profile touch schema",
    dependencies?.ensureProfileTouch ?? ensureProfileTouchSchema,
  );
  await runRequired(
    "required Design Studio schema",
    dependencies?.ensureDesignStudio ?? ensureDesignStudioSchemaBeforeListen,
  );
  await runRequired(
    "required business document schema",
    dependencies?.ensureBusinessDocuments ?? ensureBusinessDocumentSchemaBeforeListen,
  );
  await runRequired(
    "required Google Drive backup schema",
    dependencies?.ensureGoogleDriveBackup ?? ensureGoogleDriveBackupSchemaBeforeListen,
  );
}
