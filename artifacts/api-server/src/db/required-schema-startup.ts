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

const REQUIRED_SCHEMA_TIMEOUT_MS = 120_000;

type RequiredStep = () => Promise<unknown>;
type RequiredStepRunner = (
  name: string,
  step: RequiredStep,
  timeoutMs?: number,
  onTimeout?: (error: Error) => void,
) => Promise<unknown>;

function isDroppedDatabaseConnection(error: unknown): boolean {
  return error instanceof Error
    && /connection (?:terminated|closed) unexpectedly|econnreset/i.test(error.message);
}

export async function runRequiredSchemaStartup(dependencies?: {
  run?: RequiredStepRunner;
  ensurePaperNotes?: RequiredStep;
  ensureGoogleWorkspace?: RequiredStep;
  ensureLeadIntake?: RequiredStep;
  ensureLegAssignment?: RequiredStep;
  ensureEventReviewDismissals?: RequiredStep;
  ensureFollowUpDismissals?: RequiredStep;
  ensureOrganizerFeedback?: RequiredStep;
  ensureComputerCalling?: RequiredStep;
  ensureInboundCalling?: RequiredStep;
  ensureOfficeCoordinator?: RequiredStep;
  ensureBoss?: RequiredStep;
  ensureWebsiteInquiries?: RequiredStep;
  ensureProfileFiller?: RequiredStep;
  ensureProfileTouch?: RequiredStep;
  ensureDesignStudio?: RequiredStep;
  ensureBusinessDocuments?: RequiredStep;
  ensureGoogleDriveBackup?: RequiredStep;
}): Promise<void> {
  const run = dependencies?.run ?? runStartupStep;
  const runRequired = async (
    name: string,
    step: RequiredStep,
    onTimeout?: (error: Error) => void,
  ) => {
    try {
      return await run(name, step, REQUIRED_SCHEMA_TIMEOUT_MS, onTimeout);
    } catch (error) {
      if (!isDroppedDatabaseConnection(error)) throw error;
      return run(name, step, REQUIRED_SCHEMA_TIMEOUT_MS, onTimeout);
    }
  };
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
