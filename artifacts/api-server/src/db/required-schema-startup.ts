import { runStartupStep } from "../lib/startup-step";
import { ensureGoogleWorkspaceSchemaBeforeListen } from "./google-workspace-required-startup";
import { ensureLeadIntakeSchemaBeforeListen } from "./lead-intake-required-startup";
import { ensureOfficeCoordinatorSchemaBeforeListen } from "./office-coordinator-required-startup";
import { ensurePaperNotesSchemaBeforeListen } from "./paper-notes-required-startup";
import { ensureProfileTouchSchema } from "../features/organizations/profile-touch-schema";

type RequiredStep = () => Promise<unknown>;
type RequiredStepRunner = (name: string, step: RequiredStep) => Promise<unknown>;

export async function runRequiredSchemaStartup(dependencies?: {
  run?: RequiredStepRunner;
  ensurePaperNotes?: RequiredStep;
  ensureGoogleWorkspace?: RequiredStep;
  ensureLeadIntake?: RequiredStep;
  ensureOfficeCoordinator?: RequiredStep;
  ensureProfileTouch?: RequiredStep;
}): Promise<void> {
  const run = dependencies?.run ?? runStartupStep;
  await run(
    "required paper notes schema",
    dependencies?.ensurePaperNotes ?? ensurePaperNotesSchemaBeforeListen,
  );
  await run(
    "required Google Workspace schema",
    dependencies?.ensureGoogleWorkspace ?? ensureGoogleWorkspaceSchemaBeforeListen,
  );
  await run(
    "required lead intake schema",
    dependencies?.ensureLeadIntake ?? ensureLeadIntakeSchemaBeforeListen,
  );
  await run(
    "required office coordinator schema",
    dependencies?.ensureOfficeCoordinator ?? ensureOfficeCoordinatorSchemaBeforeListen,
  );
  await run(
    "required profile touch schema",
    dependencies?.ensureProfileTouch ?? ensureProfileTouchSchema,
  );
}
