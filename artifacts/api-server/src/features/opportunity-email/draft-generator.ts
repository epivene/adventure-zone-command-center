import type { DraftContext } from "./draft-context-resolver";
import type { OpportunityDraftPurpose } from "./opportunity-email-types";

export type GeneratedOpportunityDraft = {
  subject: string;
  body: string;
};

export interface DraftGenerator {
  generate(input: {
    context: DraftContext;
    purpose: OpportunityDraftPurpose;
    existingBody?: string | null;
  }): Promise<GeneratedOpportunityDraft>;
}
