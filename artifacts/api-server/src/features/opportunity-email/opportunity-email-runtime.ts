import type { OpportunityDraftRouteService } from "@/routes/opportunity-drafts";

import type { OpportunityEmailService } from "./opportunity-email-service";
import type { OpportunityEmailRecord } from "./opportunity-email-types";
import {
  ReadyToSendService,
  type ReadyToSendSource,
} from "./ready-to-send-service";
import { ScheduledEmailDispatcher } from "./scheduled-email-dispatcher";

type SharedEmailService = Pick<
  OpportunityEmailService,
  | "createDraft"
  | "saveDraft"
  | "rewriteDraft"
  | "sendDraft"
  | "scheduleDraft"
  | "retryDraft"
>;

type RuntimeRepository = {
  getCurrentForOpportunity(opportunityId: string): Promise<OpportunityEmailRecord | null>;
  claimOneDue(input: {
    workerId: string;
    now: Date;
  }): Promise<OpportunityEmailRecord | null>;
  releaseLease(draftId: string, workerId: string, now: Date): Promise<void>;
};

export function createOpportunityEmailRuntime(deps: {
  emailService: SharedEmailService;
  repository: RuntimeRepository;
  readySource: ReadyToSendSource;
}) {
  const drafts: OpportunityDraftRouteService = {
    createDraft: (input) => deps.emailService.createDraft(input),
    getDraft: (opportunityId) => deps.repository.getCurrentForOpportunity(opportunityId),
    saveDraft: (input) => deps.emailService.saveDraft(input),
    rewriteDraft: (input) => deps.emailService.rewriteDraft(input),
    sendDraft: (input) => deps.emailService.sendDraft(input),
    scheduleDraft: (input) => deps.emailService.scheduleDraft(input),
    retryDraft: (input) => deps.emailService.retryDraft(input),
  };

  const readyToSend = new ReadyToSendService({
    source: deps.readySource,
    delivery: deps.emailService,
  });

  const dispatcher = new ScheduledEmailDispatcher({
    store: deps.repository,
    delivery: deps.emailService,
  });

  return { drafts, readyToSend, dispatcher };
}
