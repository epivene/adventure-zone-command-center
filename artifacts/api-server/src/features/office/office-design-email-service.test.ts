import { describe, expect, it, vi } from "vitest";

import type { OfficeEmailDraftView } from "./office-email-types";
import { OfficeGmailProviderError } from "./office-gmail-provider";
import { OfficeDesignEmailService } from "./office-design-email-service";

function draft(
  overrides: Partial<OfficeEmailDraftView> = {},
): OfficeEmailDraftView {
  return {
    id: "draft-1",
    officeAccountId: "account-1",
    organizationId: "organization-1",
    contactId: "contact-1",
    bookingId: null,
    eventYear: null,
    communicationTemplateId: null,
    recipientEmail: "gm@example.com",
    subject: "Subject",
    body: "<html><body>Hello</body></html>",
    bodyFormat: "html",
    designProjectId: "project-1",
    designVersionId: "version-1",
    coordinatorNote: null,
    state: "draft",
    submittedAt: null,
    ownerReturnNote: null,
    sentAt: null,
    scheduledFor: null,
    businessTimeZone: null,
    gmailDraftId: null,
    gmailMessageId: null,
    gmailThreadId: null,
    dispatchAttemptCount: 0,
    lastFailureCode: null,
    lastFailureMessage: null,
    updatedAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

function setup(existing = draft()) {
  const repository = {
    resolveDesignRecipient: vi.fn().mockResolvedValue({
      organizationId: "organization-1",
      contactId: "contact-1",
      recipientEmail: "gm@example.com",
    }),
    saveCanonicalDesignDraft: vi.fn().mockResolvedValue(existing),
    markCanonicalGmailDraft: vi.fn().mockImplementation(async (input) =>
      draft({
        state: "gmail_draft",
        gmailDraftId: input.gmailDraftId,
        gmailMessageId: input.gmailMessageId,
        gmailThreadId: input.gmailThreadId,
      }),
    ),
    markCanonicalDraftFailed: vi
      .fn()
      .mockResolvedValue(draft({ state: "failed" })),
    findCanonicalByScheduleRequest: vi.fn().mockResolvedValue(null),
    findCanonicalByProject: vi.fn().mockResolvedValue(existing),
    findCanonicalBySendRequest: vi.fn().mockResolvedValue(null),
    scheduleCanonicalDraft: vi.fn().mockResolvedValue(
      draft({
        state: "scheduled",
        scheduledFor: "2026-09-14T18:00:00.000Z",
        businessTimeZone: "America/Denver",
      }),
    ),
    rescheduleCanonicalDraft: vi
      .fn()
      .mockResolvedValue(draft({ state: "scheduled" })),
    cancelCanonicalSchedule: vi
      .fn()
      .mockResolvedValue(draft({ state: "cancelled" })),
    claimCanonicalSend: vi.fn().mockResolvedValue(draft({ state: "sending" })),
    markCanonicalSent: vi.fn().mockImplementation(async (input) =>
      draft({
        state: "sent",
        gmailDraftId: input.gmailDraftId,
        gmailMessageId: input.gmailMessageId,
        gmailThreadId: input.gmailThreadId,
        sentAt: input.sentAt.toISOString(),
      }),
    ),
    storeClaimedGmailDraft: vi
      .fn()
      .mockResolvedValue(
        draft({ state: "sending", gmailDraftId: "gmail-draft-1" }),
      ),
  };
  const gmail = {
    createOrUpdateDraft: vi.fn().mockResolvedValue({
      draftId: "gmail-draft-1",
      messageId: "gmail-message-1",
      threadId: "thread-1",
    }),
    sendDraft: vi.fn().mockImplementation(async ({ beforeSend }) => {
      await beforeSend?.();
      return {
        messageId: "sent-message-1",
        threadId: "sent-thread-1",
        sentAt: new Date("2026-09-12T18:00:00.000Z"),
      };
    }),
  };
  const freeze = vi.fn().mockResolvedValue({
    versionId: "version-1",
    html: "<html><body>Hello</body></html>",
    htmlFingerprint: "fingerprint-1",
  });
  const approval = {
    assertApproved: vi.fn().mockResolvedValue(undefined),
    currentApprovedFingerprint: vi.fn().mockResolvedValue("approved-1"),
  };
  const service = new OfficeDesignEmailService({
    repository,
    gmail,
    freeze,
    approval,
    now: () => new Date("2026-09-12T12:00:00.000Z"),
  });
  return {
    repository,
    gmail,
    freeze,
    approval,
    service,
  };
}

const command = {
  projectId: "project-1",
  accountId: "account-1",
  subject: "Subject",
};

describe("Office Design email commands", () => {
  it("saves the frozen HTML in app without touching Gmail", async () => {
    const { service, repository, gmail } = setup();
    await expect(service.saveInApp(command)).resolves.toMatchObject({
      bodyFormat: "html",
      state: "draft",
      designVersionId: "version-1",
    });
    expect(repository.saveCanonicalDesignDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "gm@example.com",
        html: "<html><body>Hello</body></html>",
      }),
    );
    expect(gmail.createOrUpdateDraft).not.toHaveBeenCalled();
  });

  it("creates and then updates the one canonical Gmail draft", async () => {
    const first = setup();
    await expect(
      first.service.createGmailDraft(command),
    ).resolves.toMatchObject({
      state: "gmail_draft",
      gmailDraftId: "gmail-draft-1",
    });
    expect(first.gmail.createOrUpdateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ gmailDraftId: null, to: "gm@example.com" }),
    );

    const repeated = setup(draft({ gmailDraftId: "gmail-draft-1" }));
    await repeated.service.createGmailDraft(command);
    expect(repeated.gmail.createOrUpdateDraft).toHaveBeenCalledWith(
      expect.objectContaining({ gmailDraftId: "gmail-draft-1" }),
    );
  });

  it("persists a manual-review failure after an ambiguous Gmail result", async () => {
    const { service, gmail, repository } = setup();
    gmail.createOrUpdateDraft.mockRejectedValue(
      new OfficeGmailProviderError("GMAIL_DRAFT_OUTCOME_UNKNOWN"),
    );
    await expect(service.createGmailDraft(command)).rejects.toMatchObject({
      code: "GMAIL_DRAFT_OUTCOME_UNKNOWN",
    });
    expect(repository.markCanonicalDraftFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "GMAIL_DRAFT_OUTCOME_UNKNOWN",
        message: expect.stringMatching(/check gmail/i),
      }),
    );
  });

  it("schedules only future, approved content and replays a request key", async () => {
    const first = setup();
    await expect(
      first.service.schedule({
        ...command,
        requestKey: "schedule-1",
        scheduledFor: new Date("2026-09-14T18:00:00.000Z"),
        businessTimeZone: "America/Denver",
        approvedFingerprint: "approved-1",
      }),
    ).resolves.toMatchObject({ state: "scheduled" });
    expect(first.approval.assertApproved).toHaveBeenCalledWith({
      draftId: "draft-1",
      approvedFingerprint: "approved-1",
    });

    const replay = setup();
    replay.repository.findCanonicalByScheduleRequest.mockResolvedValue(
      draft({ state: "scheduled" }),
    );
    await replay.service.schedule({
      ...command,
      requestKey: "schedule-1",
      scheduledFor: new Date("2026-09-14T18:00:00.000Z"),
      businessTimeZone: "America/Denver",
      approvedFingerprint: "approved-1",
    });
    expect(replay.freeze).not.toHaveBeenCalled();
  });

  it("rejects stale approval and records durable Gmail IDs after send", async () => {
    const stale = setup();
    stale.approval.assertApproved.mockRejectedValue(
      Object.assign(new Error("OUTREACH_APPROVAL_STALE"), {
        code: "OUTREACH_APPROVAL_STALE",
      }),
    );
    await expect(
      stale.service.sendNow({
        ...command,
        requestKey: "send-stale",
        approvedFingerprint: "old",
      }),
    ).rejects.toMatchObject({ code: "OUTREACH_APPROVAL_STALE" });
    expect(stale.gmail.sendDraft).not.toHaveBeenCalled();

    const current = setup();
    await expect(
      current.service.sendNow({
        ...command,
        requestKey: "send-1",
        approvedFingerprint: "approved-1",
      }),
    ).resolves.toMatchObject({
      state: "sent",
      gmailMessageId: "sent-message-1",
      gmailThreadId: "sent-thread-1",
    });
    expect(current.approval.assertApproved).toHaveBeenCalledTimes(2);
    expect(current.repository.markCanonicalSent).toHaveBeenCalledWith(
      expect.objectContaining({
        gmailDraftId: "gmail-draft-1",
        gmailMessageId: "sent-message-1",
        gmailThreadId: "sent-thread-1",
      }),
    );
  });

  it("rechecks approval after claiming and before the provider send", async () => {
    const current = setup();
    current.approval.assertApproved
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error("OUTREACH_APPROVAL_STALE"), {
          code: "OUTREACH_APPROVAL_STALE",
        }),
      );
    await expect(
      current.service.sendNow({
        ...command,
        requestKey: "send-race",
        approvedFingerprint: "approved-1",
      }),
    ).rejects.toMatchObject({ code: "OUTREACH_APPROVAL_STALE" });
    expect(current.repository.markCanonicalDraftFailed).toHaveBeenCalledWith(
      expect.objectContaining({ code: "OUTREACH_APPROVAL_STALE" }),
    );
    expect(current.repository.markCanonicalSent).not.toHaveBeenCalled();
  });

  it("replays a completed send request without invoking Gmail again", async () => {
    const current = setup();
    current.repository.findCanonicalBySendRequest.mockResolvedValue(
      draft({ state: "sent", gmailMessageId: "sent-message-1" }),
    );
    await expect(
      current.service.sendNow({
        ...command,
        requestKey: "send-1",
        approvedFingerprint: "approved-1",
      }),
    ).resolves.toMatchObject({ state: "sent" });
    expect(current.gmail.createOrUpdateDraft).not.toHaveBeenCalled();
    expect(current.gmail.sendDraft).not.toHaveBeenCalled();
  });

  it("rejects past schedules and unknown business timezones", async () => {
    const current = setup();
    await expect(
      current.service.schedule({
        ...command,
        requestKey: "past",
        scheduledFor: new Date("2026-09-11T12:00:00.000Z"),
        businessTimeZone: "America/Denver",
        approvedFingerprint: "approved-1",
      }),
    ).rejects.toThrow("EMAIL_SCHEDULE_NOT_FUTURE");
    await expect(
      current.service.schedule({
        ...command,
        requestKey: "bad-zone",
        scheduledFor: new Date("2026-09-14T12:00:00.000Z"),
        businessTimeZone: "Mars/Olympus",
        approvedFingerprint: "approved-1",
      }),
    ).rejects.toThrow("EMAIL_TIME_ZONE_INVALID");
  });

  it("reschedules and cancels only through repository state guards", async () => {
    const current = setup();
    await current.service.reschedule({
      draftId: "draft-1",
      accountId: "account-1",
      requestKey: "reschedule-1",
      scheduledFor: new Date("2026-09-15T18:00:00.000Z"),
      businessTimeZone: "America/Denver",
      approvedFingerprint: "approved-1",
    });
    await current.service.cancel({
      draftId: "draft-1",
      accountId: "account-1",
    });
    expect(current.repository.rescheduleCanonicalDraft).toHaveBeenCalledOnce();
    expect(current.repository.cancelCanonicalSchedule).toHaveBeenCalledOnce();
  });

  it("sends an already claimed scheduled version without refreezing it", async () => {
    const current = setup();
    await expect(
      current.service.sendClaimed({
        draft: draft({ state: "sending", dispatchAttemptCount: 1 }),
        workerId: "worker-1",
      }),
    ).resolves.toMatchObject({ state: "sent" });
    expect(current.freeze).not.toHaveBeenCalled();
    expect(current.repository.storeClaimedGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "worker-1" }),
    );
    expect(current.repository.markCanonicalSent).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "worker-1" }),
    );
  });
});
