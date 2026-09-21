import { describe, expect, it, vi } from "vitest";

import type { MailDelivery } from "../office/mail-delivery";
import {
  WebsiteInquiryAlertWorker,
  type WebsiteInquiryAlertClaim,
  type WebsiteInquiryAlertRepository,
} from "./website-inquiry-alert-worker";

const now = new Date("2026-09-03T16:00:00.000Z");

function claim(
  overrides: Partial<WebsiteInquiryAlertClaim> = {},
): WebsiteInquiryAlertClaim {
  return {
    id: "20000000-0000-4000-8000-000000000002",
    referenceCode: "AZI-2026-AAAAAAAA",
    name: "Desie Example",
    email: "desie@example.com",
    eventName: "Summer Festival",
    eventDate: "2027-07-04",
    eventLocation: "Denver, CO",
    packageInterest: "Adventure Zone",
    message: "This complete private visitor message must not be emailed.",
    alertAttemptCount: 1,
    alertDeliveredRecipients: [],
    alertLeaseOwner: "website-inquiry-worker-a",
    ...overrides,
  };
}

function setup(input?: {
  claimed?: WebsiteInquiryAlertClaim | null;
  recipients?: string;
  send?: MailDelivery["send"];
}) {
  const claimed = input && "claimed" in input ? input.claimed : claim();
  const repository: WebsiteInquiryAlertRepository = {
    claimNextAlert: vi.fn(async () => claimed ?? null),
    recordRecipientDelivered: vi.fn(async () => undefined),
    completeAlert: vi.fn(async () => undefined),
    failAlert: vi.fn(async () => undefined),
  };
  const mailDelivery: MailDelivery = {
    send:
      input?.send ??
      vi.fn(async () => ({ messageId: "message-1" })),
  };
  const worker = new WebsiteInquiryAlertWorker({
    repository,
    recipients: input?.recipients ??
      " Owner@Example.com, amy@example.com,owner@example.com ",
    inboxBaseUrl: "https://command.example.com/",
    createMailDelivery: () => mailDelivery,
  });
  return { mailDelivery, repository, worker };
}

describe("WebsiteInquiryAlertWorker", () => {
  it("emails each unique unsent recipient with one secure workspace link", async () => {
    const h = setup({
      claimed: claim({ alertDeliveredRecipients: ["owner@example.com"] }),
    });

    await expect(
      h.worker.runOne({ workerId: "website-inquiry-worker-a", now }),
    ).resolves.toEqual({ kind: "progress" });

    expect(h.repository.claimNextAlert).toHaveBeenCalledWith({
      workerId: "website-inquiry-worker-a",
      now,
      leaseMs: 5 * 60_000,
    });
    expect(h.mailDelivery.send).toHaveBeenCalledTimes(1);
    expect(h.mailDelivery.send).toHaveBeenCalledWith({
      to: "amy@example.com",
      subject: "Website inquiry AZI-2026-AAAAAAAA: Summer Festival",
      body: expect.stringContaining("Desie Example <desie@example.com>"),
    });
    const body = vi.mocked(h.mailDelivery.send).mock.calls[0]?.[0].body ?? "";
    expect(body).toContain("Event date: 2027-07-04");
    expect(body).toContain("Event location: Denver, CO");
    expect(body).toContain(
      "https://command.example.com/website-inquiries?inquiry=20000000-0000-4000-8000-000000000002",
    );
    expect(body).toContain("Open in the workspace:");
    expect(body).not.toContain("Open in the owner workspace:");
    expect(body).not.toContain("/office/website-inquiries?inquiry=");
    expect(body).not.toContain("complete private visitor message");
    expect(h.repository.recordRecipientDelivered).toHaveBeenCalledWith({
      inquiryId: claim().id,
      leaseOwner: "website-inquiry-worker-a",
      recipient: "amy@example.com",
      now,
    });
    expect(h.repository.completeAlert).toHaveBeenCalledWith({
      inquiryId: claim().id,
      leaseOwner: "website-inquiry-worker-a",
      now,
    });
  });

  it("persists a successful recipient before another recipient fails", async () => {
    const send = vi
      .fn<MailDelivery["send"]>()
      .mockResolvedValueOnce({ messageId: "message-1" })
      .mockRejectedValueOnce(new Error("relay refused"));
    const h = setup({ send, recipients: "owner@example.com,amy@example.com" });

    await h.worker.runOne({ workerId: "website-inquiry-worker-a", now });

    expect(h.repository.recordRecipientDelivered).toHaveBeenCalledTimes(1);
    expect(h.repository.recordRecipientDelivered).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: "owner@example.com" }),
    );
    expect(h.repository.completeAlert).not.toHaveBeenCalled();
    expect(h.repository.failAlert).toHaveBeenCalledWith(
      expect.objectContaining({ terminal: false }),
    );
  });

  it.each([
    [1, 60_000],
    [2, 5 * 60_000],
    [3, 30 * 60_000],
    [4, 2 * 60 * 60_000],
    [5, 8 * 60 * 60_000],
  ])(
    "schedules the bounded retry for failed attempt %i",
    async (alertAttemptCount, delayMs) => {
      const sensitive = `smtp://secret-user:secret-password@example.com/${"x".repeat(400)}`;
      const h = setup({
        claimed: claim({ alertAttemptCount }),
        send: vi.fn(async () => {
          throw new Error(sensitive);
        }),
      });

      await h.worker.runOne({ workerId: "website-inquiry-worker-a", now });

      const failure = vi.mocked(h.repository.failAlert).mock.calls[0]?.[0];
      expect(failure).toMatchObject({
        inquiryId: claim().id,
        leaseOwner: "website-inquiry-worker-a",
        nextAttemptAt: new Date(now.getTime() + delayMs),
        terminal: false,
      });
      expect(failure?.reason.length).toBeLessThanOrEqual(300);
      expect(failure?.reason).not.toContain("secret-user");
      expect(failure?.reason).not.toContain("secret-password");
    },
  );

  it("marks attempt six failed without scheduling another retry", async () => {
    const h = setup({
      claimed: claim({ alertAttemptCount: 6 }),
      send: vi.fn(async () => {
        throw new Error("SMTP unavailable");
      }),
    });

    await h.worker.runOne({ workerId: "website-inquiry-worker-a", now });

    expect(h.repository.failAlert).toHaveBeenCalledWith({
      inquiryId: claim().id,
      leaseOwner: "website-inquiry-worker-a",
      now,
      nextAttemptAt: null,
      reason: "Email delivery failed.",
      terminal: true,
    });
  });

  it("marks missing recipient configuration failed without throwing", async () => {
    const h = setup({ recipients: "  " });

    await expect(
      h.worker.runOne({ workerId: "website-inquiry-worker-a", now }),
    ).resolves.toEqual({ kind: "progress" });

    expect(h.mailDelivery.send).not.toHaveBeenCalled();
    expect(h.repository.failAlert).toHaveBeenCalledWith({
      inquiryId: claim().id,
      leaseOwner: "website-inquiry-worker-a",
      now,
      nextAttemptAt: null,
      reason: "Website inquiry alert recipients are not configured.",
      terminal: true,
    });
  });

  it("returns idle when another worker owns the active lease", async () => {
    const h = setup({ claimed: null });

    await expect(
      h.worker.runOne({ workerId: "website-inquiry-worker-b", now }),
    ).resolves.toEqual({ kind: "idle" });

    expect(h.mailDelivery.send).not.toHaveBeenCalled();
    expect(h.repository.completeAlert).not.toHaveBeenCalled();
  });
});
