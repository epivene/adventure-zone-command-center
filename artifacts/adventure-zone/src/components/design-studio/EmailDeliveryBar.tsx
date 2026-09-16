import { useEffect, useState } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import { Link } from "wouter";
import {
  designStudioApi,
  type DesignEmailDeliveryStatus,
  type DesignProject,
} from "@/lib/design-studio-api";
import {
  businessLocalInputToUtc,
  formatBusinessSchedule,
} from "@/lib/business-time-zone";

const BUSINESS_TIME_ZONE =
  import.meta.env.VITE_BUSINESS_TIME_ZONE || "America/Denver";

function Button({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: string;
  size?: string;
}) {
  const { variant: _variant, size: _size, ...buttonProps } = props;
  return (
    <button
      className={`inline-flex min-h-9 items-center justify-center border border-[#d8d1c4] bg-white px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      type="button"
      {...buttonProps}
    />
  );
}

function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-9 w-full border border-[#d8d1c4] px-3 ${className}`}
      {...props}
    />
  );
}

function requestKey() {
  return (
    globalThis.crypto?.randomUUID?.() ?? `email-${Date.now()}-${Math.random()}`
  );
}

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  return value?.startsWith("/profiles") && !value.startsWith("//")
    ? value
    : "/profiles";
}

export function EmailDeliveryBar({
  project,
  dirty,
  saving,
  save,
}: {
  project: DesignProject;
  dirty: boolean;
  saving: boolean;
  save(): Promise<boolean>;
}) {
  const [status, setStatus] = useState<DesignEmailDeliveryStatus | null>(null);
  const [subject, setSubject] = useState(project.name);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showSchedule, setShowSchedule] = useState(false);
  const [localDateTime, setLocalDateTime] = useState("");

  const reload = async () => {
    const next = await designStudioApi.emailStatus(project.id);
    setStatus(next);
    setSubject(next.draft?.subject || project.name);
    return next;
  };

  useEffect(() => {
    void reload().catch((cause) =>
      setError(
        cause instanceof Error
          ? cause.message
          : "Email delivery status is unavailable.",
      ),
    );
  }, [project.id]);

  useEffect(() => {
    if (dirty && status?.approvedFingerprint) {
      setStatus({
        ...status,
        approvalCurrent: false,
        approvedFingerprint: null,
      });
    }
  }, [dirty]);

  async function prepared() {
    if (!(await save()))
      throw new Error("Save the current email before continuing.");
  }

  async function run(
    label: string,
    action: () => Promise<{ draft: DesignEmailDeliveryStatus["draft"] }>,
    prepare = true,
  ) {
    setBusy(label);
    setError(null);
    setMessage(null);
    try {
      if (prepare) await prepared();
      const result = await action();
      const next = await reload();
      setMessage(
        result.draft?.state === "sent"
          ? "Sent through Gmail. Add a follow-up from the profile when useful."
          : result.draft?.state === "scheduled"
            ? `Scheduled ${formatBusinessSchedule({ utcDateTime: result.draft.scheduledFor!, timeZone: result.draft.businessTimeZone! })}.`
            : result.draft?.state === "gmail_draft"
              ? "Saved to Gmail Drafts."
              : "Saved in the Command Center.",
      );
      setStatus(next);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "The email command failed.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function approveCurrent() {
    setBusy("review");
    setError(null);
    try {
      await prepared();
      const { draft } = await designStudioApi.saveEmailInApp(
        project.id,
        subject,
      );
      const review = await designStudioApi.reviewEmailContent(draft.id);
      await designStudioApi.approveEmailContent(draft.id, review.digest);
      await reload();
      setMessage(
        "The exact recipient, subject, and HTML are approved for delivery.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not approve this email.",
      );
    } finally {
      setBusy(null);
    }
  }

  const hasRecipient = Boolean(status?.recipientEmail);
  const approved =
    !status?.approvalRequired ||
    Boolean(status?.approvalCurrent && status.approvedFingerprint);
  const commandsDisabled =
    saving || Boolean(busy) || !hasRecipient || !subject.trim();
  const returnTo = safeReturnTo();

  return (
    <section
      className="border-t border-[#d8d1c4] bg-[#fffefa] px-4 py-3 text-[#182225]"
      data-testid="email-delivery-bar"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem] flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-[#536064]">
            To
          </p>
          <p className="truncate text-sm font-semibold">
            {status === null
              ? "Loading contact…"
              : (status.recipientEmail ?? "Add a contact email first")}
          </p>
        </div>
        <label className="min-w-[16rem] flex-[2] text-[11px] font-bold uppercase tracking-wide text-[#536064]">
          Subject
          <Input
            aria-label="Email subject"
            className="mt-1 bg-white text-sm normal-case tracking-normal"
            disabled={Boolean(busy)}
            onChange={(event) => {
              setSubject(event.target.value);
              if (status?.approvedFingerprint)
                setStatus({
                  ...status,
                  approvalCurrent: false,
                  approvedFingerprint: null,
                });
            }}
            value={subject}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={commandsDisabled}
            onClick={() =>
              void run("save", () =>
                designStudioApi.saveEmailInApp(project.id, subject),
              )
            }
            variant="outline"
          >
            Save in app
          </Button>
          <Button
            disabled={commandsDisabled || !status?.gmailConnected}
            onClick={() =>
              void run("gmail", () =>
                designStudioApi.createGmailDraft(project.id, subject),
              )
            }
            variant="outline"
          >
            Create Gmail Draft
          </Button>
          <Button
            disabled={commandsDisabled || approved}
            onClick={() => void approveCurrent()}
            variant="outline"
          >
            Review exact email
          </Button>
          <Button
            disabled={commandsDisabled || !approved || !status?.gmailConnected}
            onClick={() => setShowSchedule(!showSchedule)}
            variant="outline"
          >
            Schedule
          </Button>
          <Button
            className="bg-[#e85d35] text-white hover:bg-[#bc3e20]"
            disabled={commandsDisabled || !approved || !status?.gmailConnected}
            onClick={() =>
              void run("send", () =>
                designStudioApi.sendEmailNow(project.id, {
                  subject,
                  requestKey: requestKey(),
                  approvedFingerprint:
                    status?.approvedFingerprint ?? "approval-not-required",
                }),
              )
            }
          >
            Send Now
          </Button>
        </div>
      </div>

      {showSchedule ? (
        <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[#d8d1c4] pt-3">
          <label className="text-xs font-semibold">
            Business time ({BUSINESS_TIME_ZONE})
            <Input
              aria-label="Schedule date and time"
              className="mt-1 bg-white"
              onChange={(event) => setLocalDateTime(event.target.value)}
              type="datetime-local"
              value={localDateTime}
            />
          </label>
          <Button
            disabled={!localDateTime || commandsDisabled}
            onClick={() => {
              let scheduledFor: string;
              try {
                scheduledFor = businessLocalInputToUtc({
                  localDateTime,
                  timeZone: BUSINESS_TIME_ZONE,
                });
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Choose another time.",
                );
                return;
              }
              const input = {
                subject,
                requestKey: requestKey(),
                approvedFingerprint:
                  status?.approvedFingerprint ?? "approval-not-required",
                scheduledFor,
                businessTimeZone: BUSINESS_TIME_ZONE,
              };
              const rescheduling = status?.draft?.state === "scheduled";
              void run(
                "schedule",
                () =>
                  rescheduling
                    ? designStudioApi.rescheduleEmail(project.id, input)
                    : designStudioApi.scheduleEmail(project.id, input),
                !rescheduling,
              ).then(() => setShowSchedule(false));
            }}
          >
            Confirm schedule
          </Button>
        </div>
      ) : null}

      {status?.draft?.state === "scheduled" ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <strong>Scheduled:</strong>
          <span>
            {formatBusinessSchedule({
              utcDateTime: status.draft.scheduledFor!,
              timeZone: status.draft.businessTimeZone!,
            })}
          </span>
          <Button
            onClick={() => setShowSchedule(true)}
            size="sm"
            variant="ghost"
          >
            Reschedule
          </Button>
          <Button
            onClick={() =>
              void run(
                "cancel",
                () => designStudioApi.cancelScheduledEmail(project.id),
                false,
              )
            }
            size="sm"
            variant="ghost"
          >
            Cancel schedule
          </Button>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 text-sm text-[#a63f35]" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-2 text-sm text-[#32765a]" role="status">
          {message}{" "}
          <Link className="underline" href={returnTo}>
            Return to profile
          </Link>
        </p>
      ) : null}
    </section>
  );
}
