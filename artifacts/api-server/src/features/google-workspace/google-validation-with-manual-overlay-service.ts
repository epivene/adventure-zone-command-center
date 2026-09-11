import {
  GoogleAiRecentValidationService,
  type GoogleAiRecentValidationResult,
} from "./google-ai-recent-validation-service";
import type { GoogleRecentValidationResult } from "./google-recent-validation-service";
import {
  GoogleValidationManualDecisionOverlay,
  type GoogleValidationResultLike,
} from "./google-validation-manual-decision-overlay";

type ValidationOutput = GoogleRecentValidationResult | GoogleAiRecentValidationResult;
type ValidationAccess = {
  run(
    limit: number,
    options?: { skipProcessed?: boolean },
  ): Promise<ValidationOutput>;
};
type OverlayAccess = {
  apply<T extends GoogleValidationResultLike>(result: T): Promise<T>;
};

export class GoogleValidationWithManualOverlayService {
  constructor(
    private readonly base: ValidationAccess = new GoogleAiRecentValidationService(),
    private readonly overlay: OverlayAccess = new GoogleValidationManualDecisionOverlay(),
  ) {}

  async run(
    limit: number,
    options?: { skipProcessed?: boolean },
  ): Promise<ValidationOutput> {
    const result = await this.base.run(limit, options);
    return this.overlay.apply(result);
  }
}
