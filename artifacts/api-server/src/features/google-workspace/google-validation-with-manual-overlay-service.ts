import { GoogleAiRecentValidationService } from "./google-ai-recent-validation-service";
import type { GoogleRecentValidationResult } from "./google-recent-validation-service";
import { GoogleValidationManualDecisionOverlay } from "./google-validation-manual-decision-overlay";

type ValidationAccess = { run(limit: number): Promise<GoogleRecentValidationResult> };
type OverlayAccess = { apply<T extends GoogleRecentValidationResult>(result: T): Promise<T> };

export class GoogleValidationWithManualOverlayService {
  constructor(
    private readonly base: ValidationAccess = new GoogleAiRecentValidationService(),
    private readonly overlay: OverlayAccess = new GoogleValidationManualDecisionOverlay(),
  ) {}

  async run(limit: number): Promise<GoogleRecentValidationResult> {
    return this.overlay.apply(await this.base.run(limit));
  }
}
