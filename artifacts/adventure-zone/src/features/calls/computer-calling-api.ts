import { apiFetch } from "@/lib/auth-token";
import type {
  ComputerCallingApi,
  ComputerCallIntentContext,
  ComputerCallSession,
} from "./computer-calling-types";

export class ComputerCallingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ComputerCallingApiError";
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isString(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return isString(value) && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    isString(value) &&
    value.trim().length > 0 &&
    Number.isFinite(Date.parse(value))
  );
}

function isNullableTimestamp(value: unknown): value is string | null {
  return value === null || isTimestamp(value);
}

function isNullableDuration(value: unknown): value is number | null {
  return (
    value === null ||
    (typeof value === "number" && Number.isInteger(value) && value >= 0)
  );
}

const computerCallStatuses = new Set<ComputerCallSession["status"]>([
  "created",
  "queued",
  "ringing",
  "in-progress",
  "completed",
  "busy",
  "no-answer",
  "canceled",
  "failed",
  "unknown",
]);

function isComputerCallStatus(
  value: unknown,
): value is ComputerCallSession["status"] {
  return (
    isString(value) &&
    computerCallStatuses.has(value as ComputerCallSession["status"])
  );
}

function invalidShape(): never {
  throw new ComputerCallingApiError(
    "The computer calling service returned an unexpected response.",
    502,
  );
}

async function body(response: Response): Promise<unknown> {
  return response.json().catch(invalidShape);
}

const recoveryMessages: Record<string, string> = {
  calling_suppressed:
    "This number is marked Do Not Call. Choose another approved number or use Phone Link.",
  phone_invalid:
    "This phone number cannot be called from the workspace. Verify the number or use Phone Link.",
  rate_limited:
    "Computer calling is temporarily busy. Wait a moment, then try again or use Phone Link.",
  configuration_incomplete:
    "Computer calling is not configured. Use Phone Link or contact an administrator.",
  configuration_missing:
    "Computer calling is not configured. Use Phone Link or contact an administrator.",
  calling_disabled:
    "Computer calling is unavailable. Use Phone Link or contact an administrator.",
  token_unavailable:
    "Computer calling could not start. Try again or use Phone Link.",
  intent_unavailable:
    "Computer calling could not start. Try again or use Phone Link.",
};

function recoveryMessage(error: string | null) {
  const normalized = error?.trim().toLowerCase() ?? "";
  return recoveryMessages[normalized]
    ?? "Computer calling could not be completed. Try again or use Phone Link.";
}

async function checked(response: Response): Promise<unknown> {
  if (response.ok) return body(response);
  const result = await response.json().catch(() => null);
  const error =
    isRecord(result) && isString(result.error)
      ? result.error
      : null;
  throw new ComputerCallingApiError(recoveryMessage(error), response.status);
}

function tokenResponse(value: unknown): { token: string; expiresAt: string } {
  if (
    !isRecord(value) ||
    !isString(value.token) ||
    value.token.trim().length === 0 ||
    !isTimestamp(value.expiresAt)
  )
    invalidShape();
  return { token: value.token, expiresAt: value.expiresAt };
}

function intentResponse(value: unknown): {
  sessionId: string;
  expiresAt: string;
} {
  if (
    !isRecord(value) ||
    !isUuid(value.sessionId) ||
    !isTimestamp(value.expiresAt)
  )
    invalidShape();
  return { sessionId: value.sessionId, expiresAt: value.expiresAt };
}

function sessionResponse(value: unknown): ComputerCallSession {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isComputerCallStatus(value.status) ||
    !isNullableTimestamp(value.startedAt) ||
    !isNullableTimestamp(value.answeredAt) ||
    !isNullableTimestamp(value.endedAt) ||
    !isNullableDuration(value.durationSeconds) ||
    !isNullableString(value.errorSummary)
  )
    invalidShape();

  return {
    id: value.id,
    status: value.status,
    startedAt: value.startedAt,
    answeredAt: value.answeredAt,
    endedAt: value.endedAt,
    durationSeconds: value.durationSeconds,
    errorSummary: value.errorSummary,
  };
}

export const computerCallingApi: ComputerCallingApi = {
  async requestToken() {
    return tokenResponse(
      await checked(
        await apiFetch("/calls/computer/token", { method: "POST" }),
      ),
    );
  },

  async createIntent(context) {
    return intentResponse(
      await checked(
        await apiFetch("/calls/computer/intents", {
          method: "POST",
          body: JSON.stringify(context),
        }),
      ),
    );
  },

  async getSession(sessionId) {
    return sessionResponse(
      await checked(
        await apiFetch(
          `/calls/computer/sessions/${encodeURIComponent(sessionId)}`,
        ),
      ),
    );
  },
};
