import {
  createMailDeliveryFromEnv,
  type MailDelivery,
} from "../office/mail-delivery";
import { logger } from "@/lib/logger";

const RETRY_DELAYS_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  8 * 60 * 60_000,
] as const;

export type WebsiteInquiryAlertClaim = {
  id: string;
  referenceCode: string;
  name: string;
  email: string;
  eventName: string;
  eventDate: string | null;
  eventLocation: string | null;
  packageInterest: string | null;
  message: string;
  alertAttemptCount: number;
  alertDeliveredRecipients: string[];
  alertLeaseOwner: string;
};

type AlertLeaseInput = {
  inquiryId: string;
  leaseOwner: string;
  now: Date;
};

export interface WebsiteInquiryAlertRepository {
  claimNextAlert(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<WebsiteInquiryAlertClaim | null>;
  recordRecipientDelivered(
    input: AlertLeaseInput & { recipient: string },
  ): Promise<void>;
  completeAlert(input: AlertLeaseInput): Promise<void>;
  failAlert(
    input: AlertLeaseInput & {
      nextAttemptAt: Date | null;
      reason: string;
      terminal: boolean;
    },
  ): Promise<void>;
}

function parseRecipients(value: string): string[] {
  const recipients: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value.split(",")) {
    const recipient = candidate.trim();
    const normalized = recipient.toLowerCase();
    if (!recipient || seen.has(normalized)) continue;
    seen.add(normalized);
    recipients.push(recipient);
  }
  return recipients;
}

function secureInboxBase(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function conciseBody(
  claim: WebsiteInquiryAlertClaim,
  inboxBaseUrl: string,
): string {
  const inquiry = encodeURIComponent(claim.id);
  return [
    `New website inquiry ${claim.referenceCode}`,
    "",
    `From: ${claim.name} <${claim.email}>`,
    `Event: ${claim.eventName}`,
    `Event date: ${claim.eventDate ?? "Not provided"}`,
    `Event location: ${claim.eventLocation ?? "Not provided"}`,
    `Package interest: ${claim.packageInterest ?? "Not provided"}`,
    "",
    "Open in the workspace:",
    `${inboxBaseUrl}/website-inquiries?inquiry=${inquiry}`,
    "",
    "The visitor's full message is available only inside the authenticated inbox.",
  ].join("\n");
}

function failureReason(error: unknown): string {
  if (
    error instanceof Error &&
    error.name === "MailConfigurationError"
  ) {
    return "Outbound email is not configured.";
  }
  return "Email delivery failed.";
}

export class WebsiteInquiryAlertWorker {
  private readonly repository: WebsiteInquiryAlertRepository;
  private readonly recipients: string[];
  private readonly inboxBaseUrl: string | null;
  private readonly createMailDelivery: () => MailDelivery;

  constructor(input: {
    repository: WebsiteInquiryAlertRepository;
    recipients?: string;
    inboxBaseUrl?: string;
    createMailDelivery?: () => MailDelivery;
  }) {
    this.repository = input.repository;
    this.recipients = parseRecipients(
      input.recipients ?? process.env.WEBSITE_INQUIRY_ALERT_RECIPIENTS ?? "",
    );
    this.inboxBaseUrl = secureInboxBase(
      input.inboxBaseUrl ?? process.env.WEBSITE_INQUIRY_INBOX_BASE_URL ?? "",
    );
    this.createMailDelivery =
      input.createMailDelivery ?? (() => createMailDeliveryFromEnv());
  }

  async runOne(input: {
    workerId: string;
    now: Date;
  }): Promise<{ kind: "idle" | "progress" }> {
    const claimed = await this.repository.claimNextAlert({
      workerId: input.workerId,
      now: input.now,
      leaseMs: 5 * 60_000,
    });
    if (!claimed) return { kind: "idle" };

    const lease = {
      inquiryId: claimed.id,
      leaseOwner: claimed.alertLeaseOwner,
      now: input.now,
    };
    if (this.recipients.length === 0) {
      await this.repository.failAlert({
        ...lease,
        nextAttemptAt: null,
        reason: "Website inquiry alert recipients are not configured.",
        terminal: true,
      });
      return { kind: "progress" };
    }
    if (!this.inboxBaseUrl) {
      await this.repository.failAlert({
        ...lease,
        nextAttemptAt: null,
        reason: "Website inquiry inbox URL is not configured.",
        terminal: true,
      });
      return { kind: "progress" };
    }

    try {
      const delivery = this.createMailDelivery();
      const delivered = new Set(
        claimed.alertDeliveredRecipients.map((recipient) =>
          recipient.toLowerCase(),
        ),
      );
      for (const recipient of this.recipients) {
        if (delivered.has(recipient.toLowerCase())) continue;
        await delivery.send({
          to: recipient,
          subject: `Website inquiry ${claimed.referenceCode}: ${claimed.eventName}`,
          body: conciseBody(claimed, this.inboxBaseUrl),
        });
        await this.repository.recordRecipientDelivered({
          ...lease,
          recipient,
        });
        delivered.add(recipient.toLowerCase());
      }
      await this.repository.completeAlert(lease);
    } catch (error) {
      logger.warn(
        {
          inquiryId: claimed.id,
          errorCode:
            error && typeof error === "object" && "code" in error
              ? String((error as { code?: unknown }).code)
              : error instanceof Error
                ? error.message
                : "unknown",
        },
        "Website inquiry email delivery attempt failed",
      );
      const delayMs = RETRY_DELAYS_MS[claimed.alertAttemptCount - 1];
      const terminal = claimed.alertAttemptCount >= 6 || delayMs === undefined;
      await this.repository.failAlert({
        ...lease,
        nextAttemptAt: terminal
          ? null
          : new Date(input.now.getTime() + delayMs),
        reason: failureReason(error).slice(0, 300),
        terminal,
      });
    }

    return { kind: "progress" };
  }
}
