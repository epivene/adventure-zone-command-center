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

type RequiredStep = () => Promise<unknown>;
type RequiredStepRunner = (name: string, step: RequiredStep) => Promise<unknown>;

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
}): Promise<void> {
  const run = dependencies?.run ?? runStartupStep;
  await run(
    "required paper notes schema",
    dependencies?.ensurePaperNotes ?? ensurePaperNotesSchemaBeforeListen,
  );
  await run("required inbound calling schema", dependencies?.ensureInboundCalling ?? ensureInboundCallingSchemaBeforeListen);
  await run(
    "required Google Workspace schema",
    dependencies?.ensureGoogleWorkspace ?? ensureGoogleWorkspaceSchemaBeforeListen,
  );
  await run(
    "required lead intake schema",
    dependencies?.ensureLeadIntake ?? ensureLeadIntakeSchemaBeforeListen,
  );
  await run(
    "required leg assignment schema",
    dependencies?.ensureLegAssignment ?? ensureLegAssignmentSchemaBeforeListen,
  );
  await run(
    "required event review dismissal schema",
    dependencies?.ensureEventReviewDismissals ?? ensureEventReviewDismissalSchemaBeforeListen,
  );
  await run(
    "required follow-up dismissal persistence",
    dependencies?.ensureFollowUpDismissals ?? ensureFollowUpDismissalPersistenceBeforeListen,
  );
  await run(
    "required organizer feedback schema",
    dependencies?.ensureOrganizerFeedback ?? ensureOrganizerFeedbackSchemaBeforeListen,
  );
  await run(
    "required computer calling schema",
    dependencies?.ensureComputerCalling ?? ensureComputerCallingSchemaBeforeListen,
  );
  await run(
    "required office coordinator schema",
    dependencies?.ensureOfficeCoordinator ?? ensureOfficeCoordinatorSchemaBeforeListen,
  );
  await run(
    "required Boss schema",
    dependencies?.ensureBoss ?? ensureBossSchemaBeforeListen,
  );
  await run(
    "required website inquiry schema",
    dependencies?.ensureWebsiteInquiries ?? ensureWebsiteInquirySchemaBeforeListen,
  );
  await run(
    "required profile filler schema",
    dependencies?.ensureProfileFiller ?? ensureProfileFillerSchemaBeforeListen,
  );
  await run(
    "required profile touch schema",
    dependencies?.ensureProfileTouch ?? ensureProfileTouchSchema,
  );
  await run(
    "required Design Studio schema",
    dependencies?.ensureDesignStudio ?? ensureDesignStudioSchemaBeforeListen,
  );
  await run(
    "required business document schema",
    dependencies?.ensureBusinessDocuments ?? ensureBusinessDocumentSchemaBeforeListen,
  );
}
