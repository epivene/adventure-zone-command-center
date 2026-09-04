import { describe, expect, it, vi } from "vitest";

import type { WebsiteInquirySubmission } from "./public-contract";
import {
  WebsiteInquiryIntakeService,
  type WebsiteInquiryIntakeRepository,
  type WebsiteInquiryReceipt,
} from "./website-inquiry-service";

const submission: WebsiteInquirySubmission = {
  submissionId: "10000000-0000-4000-8000-000000000001",
  name: "Desie Example",
  email: " DESIE@Example.com ",
  eventName: "Summer Festival",
  eventDate: "2027-07-04",
  eventLocation: "Denver, CO",
  packageInterest: "Adventure Zone",
  message: "Please send availability.",
  website: "",
  pageUrl: "https://the-adventure-zone.com/#contact",
};

function setup() {
  const receipt: WebsiteInquiryReceipt = {
    inquiryId: "20000000-0000-4000-8000-000000000002",
    referenceCode: "AZI-2026-AAAAAAAA",
    createdAt: new Date("2026-09-03T16:00:00Z"),
  };
  const repository: WebsiteInquiryIntakeRepository = {
    findBySubmissionId: vi.fn(async () => null),
    findRecentByFingerprint: vi.fn(async () => null),
    create: vi.fn(async () => receipt),
  };
  const service = new WebsiteInquiryIntakeService({
    repository,
    now: () => new Date("2026-09-03T16:00:00Z"),
    randomUUID: () => "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  });
  return { repository, receipt, service };
}

describe("WebsiteInquiryIntakeService", () => {
  it("normalizes, fingerprints, and creates only an inquiry record", async () => {
    const { repository, receipt, service } = setup();

    await expect(
      service.createInquiry(submission, "https://the-adventure-zone.com"),
    ).resolves.toEqual({ ...receipt, duplicate: false });

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        submissionId: submission.submissionId,
        referenceCode: "AZI-2026-AAAAAAAA",
        normalizedEmail: "desie@example.com",
        contentFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        sourceOrigin: "https://the-adventure-zone.com",
      }),
    );
    expect(Object.keys(repository)).toEqual([
      "findBySubmissionId",
      "findRecentByFingerprint",
      "create",
    ]);
  });

  it("returns the original receipt for an idempotent retry", async () => {
    const { repository, receipt, service } = setup();
    vi.mocked(repository.findBySubmissionId).mockResolvedValue(receipt);

    await expect(
      service.createInquiry(submission, "https://the-adventure-zone.com"),
    ).resolves.toEqual({ ...receipt, duplicate: true });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("deduplicates identical recent content for fifteen minutes", async () => {
    const { repository, receipt, service } = setup();
    vi.mocked(repository.findRecentByFingerprint).mockResolvedValue(receipt);

    await expect(
      service.createInquiry(
        { ...submission, submissionId: "30000000-0000-4000-8000-000000000003" },
        "https://the-adventure-zone.com",
      ),
    ).resolves.toEqual({ ...receipt, duplicate: true });
    expect(repository.findRecentByFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedEmail: "desie@example.com",
        since: new Date("2026-09-03T15:45:00Z"),
      }),
    );
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("recovers a concurrent submission-id conflict", async () => {
    const { repository, receipt, service } = setup();
    vi.mocked(repository.create).mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "23505" }),
    );
    vi.mocked(repository.findBySubmissionId)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(receipt);

    await expect(
      service.createInquiry(submission, "https://the-adventure-zone.com"),
    ).resolves.toEqual({ ...receipt, duplicate: true });
  });
});
