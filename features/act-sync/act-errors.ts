export type ActApiErrorCode =
  | "not_configured"
  | "authentication_failed"
  | "permission_denied"
  | "rate_limited"
  | "unavailable"
  | "invalid_response";

const safeMessages: Record<ActApiErrorCode, string> = {
  not_configured: "Act! connection is not configured.",
  authentication_failed:
    "Act! rejected the shared account credentials. Check the Render settings.",
  permission_denied:
    "This Act! account does not currently have Web API permission.",
  rate_limited: "Act! is temporarily rate limiting requests. Try again later.",
  unavailable: "Act! could not be reached. Try again later.",
  invalid_response: "Act! returned an unexpected response.",
};

export class ActApiError extends Error {
  constructor(
    readonly code: ActApiErrorCode,
    readonly retryable: boolean,
    readonly retryAfter: string | null = null,
  ) {
    super(safeMessages[code]);
    this.name = "ActApiError";
  }
}
