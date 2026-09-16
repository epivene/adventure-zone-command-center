import { randomUUID } from "node:crypto";

import { db, pool } from "@workspace/db";
import { PostgresGoogleConnectionRepository } from "@/features/google-workspace/google-connection-repository";
import { createProductionOutreachDispatch } from "@/features/outreach-planner/production-outreach-dispatch";
import { OfficeDesignEmailService } from "@/features/office/office-design-email-service";
import { OfficeEmailDispatcher } from "@/features/office/office-email-dispatcher";
import { OfficeEmailDispatcherLoop } from "@/features/office/office-email-dispatcher-loop";
import { DrizzleOfficeEmailRepository } from "@/features/office/office-email-repository";
import { OfficeGmailProvider } from "@/features/office/office-gmail-provider";
import { startOfficeEmailWorkerRuntime } from "@/features/office/office-email-worker-runtime";

const repository = new DrizzleOfficeEmailRepository(db);
const connections = new PostgresGoogleConnectionRepository();
const outreach = createProductionOutreachDispatch(db);
const workerId = `office-email-${randomUUID()}`;

const dispatcher = new OfficeEmailDispatcher({
  repository,
  async sendClaimed({ claim, workerId: leaseOwner }) {
    const [draftConnection, deliveryConnection] = await Promise.all([
      connections.createGmailDraftClient(),
      connections.createGmailDeliveryClient(),
    ]);
    if (!draftConnection || !deliveryConnection) {
      throw Object.assign(new Error("GMAIL_CONNECTION_REQUIRED"), {
        code: "GMAIL_CONNECTION_REQUIRED",
      });
    }
    const service = new OfficeDesignEmailService({
      repository,
      gmail: new OfficeGmailProvider(
        draftConnection.client,
        deliveryConnection.client,
      ),
      freeze: async () => {
        throw new Error("SCHEDULED_EMAIL_MUST_USE_FROZEN_VERSION");
      },
      approval: {
        async currentApprovedFingerprint(draftId) {
          if (!outreach.enabled()) return "";
          const review = await outreach.review("office_email", draftId);
          if (!review.approvalCurrent)
            throw new Error("OUTREACH_APPROVAL_STALE");
          return review.digest;
        },
        async assertApproved({ draftId, approvedFingerprint }) {
          if (!outreach.enabled()) return;
          const review = await outreach.review("office_email", draftId);
          if (
            !review.approvalCurrent ||
            review.digest !== approvedFingerprint
          ) {
            throw new Error("OUTREACH_APPROVAL_STALE");
          }
        },
      },
    });
    await service.sendClaimed({ draft: claim.draft, workerId: leaseOwner });
  },
});

const loop = new OfficeEmailDispatcherLoop({
  runOne: (input) => dispatcher.runOne(input),
  workerId,
  onError: () => {
    console.error("Office email worker loop failed; retrying after backoff.");
  },
});

startOfficeEmailWorkerRuntime({
  loop,
  close: () => pool.end(),
});
