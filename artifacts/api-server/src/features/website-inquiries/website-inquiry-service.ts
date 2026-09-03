import { createHash, randomUUID as systemRandomUUID } from "node:crypto";

import type { WebsiteInquirySubmission } from "./public-contract";

export type WebsiteInquiryReceipt = {
  inquiryId: string;
  referenceCode: string;
  createdAt: Date;
};

export type NewWebsiteInquiry = Omit<WebsiteInquirySubmission, "website"> & {
  referenceCode: string;
  normalizedEmail: string;
  contentFingerprint: string;
  sourceOrigin: string;
};

export interface WebsiteInquiryIntakeRepository {
  findBySubmissionId(submissionId: string): Promise<WebsiteInquiryReceipt | null>;
  findRecentByFingerprint(input: {
    normalizedEmail: string;
    contentFingerprint: string;
    since: Date;
  }): Promise<WebsiteInquiryReceipt | null>;
  create(input: NewWebsiteInquiry): Promise<WebsiteInquiryReceipt>;
}

function normalizedText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function fingerprint(input: WebsiteInquirySubmission): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        name: normalizedText(input.name),
        email: normalizedText(input.email),
        eventName: normalizedText(input.eventName),
        eventDate: input.eventDate ?? "",
        eventLocation: normalizedText(input.eventLocation),
        packageInterest: normalizedText(input.packageInterest),
        message: normalizedText(input.message),
      }),
    )
    .digest("hex");
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: string }).code === "23505",
  );
}

export class WebsiteInquiryIntakeService {
  private readonly now: () => Date;
  private readonly randomUUID: () => string;

  constructor(
    private readonly dependencies: {
      repository: WebsiteInquiryIntakeRepository;
      now?: () => Date;
      randomUUID?: () => string;
    },
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.randomUUID = dependencies.randomUUID ?? systemRandomUUID;
  }

  async createInquiry(
    input: WebsiteInquirySubmission,
    sourceOrigin: string,
  ): Promise<WebsiteInquiryReceipt & { duplicate: boolean }> {
    const existing = await this.dependencies.repository.findBySubmissionId(
      input.submissionId,
    );
    if (existing) return { ...existing, duplicate: true };

    const now = this.now();
    const normalizedEmail = input.email.trim().toLocaleLowerCase("en-US");
    const contentFingerprint = fingerprint(input);
    const recent = await this.dependencies.repository.findRecentByFingerprint({
      normalizedEmail,
      contentFingerprint,
      since: new Date(now.getTime() - 15 * 60_000),
    });
    if (recent) return { ...recent, duplicate: true };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const referenceCode = `AZI-${now.getUTCFullYear()}-${this.randomUUID()
        .slice(0, 8)
        .toUpperCase()}`;
      try {
        const created = await this.dependencies.repository.create({
          ...input,
          normalizedEmail,
          contentFingerprint,
          referenceCode,
          sourceOrigin,
        });
        return { ...created, duplicate: false };
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const concurrent =
          await this.dependencies.repository.findBySubmissionId(
            input.submissionId,
          );
        if (concurrent) return { ...concurrent, duplicate: true };
        if (attempt === 2) throw error;
      }
    }
    throw new Error("Website inquiry reference generation failed");
  }
}
