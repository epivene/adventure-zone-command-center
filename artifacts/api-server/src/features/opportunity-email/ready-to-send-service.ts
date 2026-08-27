import type {
  OpportunityDraftPurpose,
  OpportunityEmailRecord,
  OpportunityEmailState,
} from "./opportunity-email-types";

export type ReadyToSendSourceRow = {
  draft: OpportunityEmailRecord;
  eventName: string;
  opportunityStatus: string;
  ownerVisible: boolean;
  blocked: boolean;
  warning: string | null;
};

export type ReadyToSendItem = {
  draftId: string;
  opportunityId: string;
  organizationId: string;
  eventName: string;
  recipientEmail: string;
  recipientName: string | null;
  purpose: OpportunityDraftPurpose;
  opportunityStatus: string;
  state: OpportunityEmailState;
  scheduledFor: string | null;
  warning: string | null;
};

export type ReadyToSendSummary = {
  total: number;
  newOutreach: number;
  followUps: number;
  replies: number;
  items: ReadyToSendItem[];
};

export type ReadyToSendSource = {
  list(): Promise<ReadyToSendSourceRow[]>;
  get(draftId: string): Promise<ReadyToSendSourceRow | null>;
};

export type ReadyToSendDelivery = {
  sendDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
  }): Promise<unknown>;
  scheduleDraft(input: {
    opportunityId: string;
    draftId: string;
    requestKey: string;
    scheduledFor: Date;
  }): Promise<unknown>;
};

export type ReadyToSendResult = {
  draftId: string;
  ok: boolean;
  error?: string;
};

type SendSelection = {
  draftId: string;
  opportunityId: string;
  requestKey: string;
};

type ScheduleSelection = SendSelection & {
  scheduledFor: Date;
};

function outboxState(state: OpportunityEmailState): boolean {
  return state === "draft" || state === "scheduled" || state === "failed";
}

function selectionError(code = "READY_TO_SEND_SELECTION_INVALID"): Error {
  return Object.assign(new Error(code), { code });
}

function operationErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return error instanceof Error && error.message ? error.message : "READY_TO_SEND_OPERATION_FAILED";
}

export class ReadyToSendService {
  constructor(private readonly deps: {
    source: ReadyToSendSource;
    delivery: ReadyToSendDelivery;
  }) {}

  async summary(): Promise<ReadyToSendSummary> {
    const rows = (await this.deps.source.list()).filter((row) => outboxState(row.draft.state));
    const items = rows.map((row): ReadyToSendItem => ({
      draftId: row.draft.id,
      opportunityId: row.draft.opportunityId,
      organizationId: row.draft.organizationId,
      eventName: row.eventName,
      recipientEmail: row.draft.recipientEmail,
      recipientName: row.draft.recipientName,
      purpose: row.draft.purpose,
      opportunityStatus: row.opportunityStatus,
      state: row.draft.state,
      scheduledFor: row.draft.scheduledFor?.toISOString() ?? null,
      warning: row.warning ?? row.draft.lastFailureMessage,
    }));

    return {
      total: items.length,
      newOutreach: items.filter((item) => item.purpose === "new_outreach").length,
      followUps: items.filter((item) => item.purpose === "follow_up").length,
      replies: items.filter((item) => item.purpose === "reply").length,
      items,
    };
  }

  async sendSelected(selection: SendSelection[]): Promise<ReadyToSendResult[]> {
    await this.prevalidate(selection);
    const results: ReadyToSendResult[] = [];
    for (const item of selection) {
      try {
        await this.deps.delivery.sendDraft(item);
        results.push({ draftId: item.draftId, ok: true });
      } catch (error) {
        results.push({ draftId: item.draftId, ok: false, error: operationErrorCode(error) });
      }
    }
    return results;
  }

  async scheduleSelected(selection: ScheduleSelection[]): Promise<ReadyToSendResult[]> {
    await this.prevalidate(selection);
    const results: ReadyToSendResult[] = [];
    for (const item of selection) {
      try {
        await this.deps.delivery.scheduleDraft(item);
        results.push({ draftId: item.draftId, ok: true });
      } catch (error) {
        results.push({ draftId: item.draftId, ok: false, error: operationErrorCode(error) });
      }
    }
    return results;
  }

  private async prevalidate(selection: SendSelection[]): Promise<void> {
    if (selection.length === 0) throw selectionError();

    const rows = await Promise.all(selection.map((item) => this.deps.source.get(item.draftId)));
    for (let index = 0; index < selection.length; index += 1) {
      const item = selection[index]!;
      const row = rows[index];
      if (
        !row ||
        !row.ownerVisible ||
        row.blocked ||
        row.draft.opportunityId !== item.opportunityId ||
        !outboxState(row.draft.state)
      ) {
        throw selectionError();
      }
    }
  }
}
