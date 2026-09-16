import { describe, expect, it, vi } from "vitest";

import type { OfficeEmailDraftView } from "./office-email-types";
import {
  OfficeEmailDispatcher,
  officeEmailRetryDelayMs,
} from "./office-email-dispatcher";

const dueDraft = {
  id: "draft-1",
  officeAccountId: "account-1",
  designVersionId: "version-1",
  dispatchAttemptCount: 1,
} as OfficeEmailDraftView;

describe("scheduled Office email dispatcher", () => {
  it("sends one claimed due row and leaves a second worker idle", async () => {
    const repository = {
      claimOneDue: vi
        .fn()
        .mockResolvedValueOnce({
          draft: dueDraft,
          sendRequestKey: "scheduled:draft-1:version-1",
        })
        .mockResolvedValueOnce(null),
      recordClaimedFailure: vi.fn(),
    };
    const sendClaimed = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new OfficeEmailDispatcher({ repository, sendClaimed });
    const now = new Date("2026-09-12T18:00:00.000Z");

    await expect(
      dispatcher.runOne({ workerId: "worker-1", now }),
    ).resolves.toBe("sent");
    await expect(
      dispatcher.runOne({ workerId: "worker-2", now }),
    ).resolves.toBe("idle");
    expect(sendClaimed).toHaveBeenCalledWith({
      claim: expect.objectContaining({
        sendRequestKey: "scheduled:draft-1:version-1",
      }),
      workerId: "worker-1",
    });
  });

  it("uses bounded retry and never retries an uncertain provider outcome", async () => {
    expect(officeEmailRetryDelayMs(1)).toBe(30_000);
    expect(officeEmailRetryDelayMs(20)).toBe(3_600_000);
    const repository = {
      claimOneDue: vi.fn().mockResolvedValue({
        draft: dueDraft,
        sendRequestKey: "scheduled:draft-1:version-1",
      }),
      recordClaimedFailure: vi.fn(),
    };
    const dispatcher = new OfficeEmailDispatcher({
      repository,
      sendClaimed: vi.fn().mockRejectedValue(
        Object.assign(new Error("uncertain"), {
          code: "GMAIL_SEND_OUTCOME_UNKNOWN",
        }),
      ),
    });
    await expect(
      dispatcher.runOne({
        workerId: "worker-1",
        now: new Date("2026-09-12T18:00:00.000Z"),
      }),
    ).resolves.toBe("failed");
    expect(repository.recordClaimedFailure).toHaveBeenCalledWith(
      expect.objectContaining({ retryable: false, nextAttemptAt: null }),
    );
  });
});
