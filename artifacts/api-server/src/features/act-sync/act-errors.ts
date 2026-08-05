export type ActApiErrorCode =
  | "not_configured"
  | "authentication_failed"
  | "permission_denied"
  | "query_rejected"
  | "not_found"
  | "endpoint_unsupported"
  | "rate_limited"
  | "timeout"
  | "unavailable"
  | "invalid_response"
  | "pagination_stalled";

export type ActWriteOutcome = "not_applied" | "unknown";

const safeMessages: Record<ActApiErrorCode, string> = {
  not_configured: "Act! connection is not configured.",
  authentication_failed:
    "Act! rejected the shared account credentials. Check the Render settings.",
  permission_denied:
    "This Act! account does not currently have Web API permission.",
  query_rejected: "Act! rejected the requested query options.",
  not_found: "The requested Act! endpoint or record was not found.",
  endpoint_unsupported: "The requested Act! endpoint is not supported.",
  rate_limited: "Act! is temporarily rate limiting requests. Try again later.",
  timeout: "The Act! request timed out. Try again later.",
  unavailable: "Act! could not be reached. Try again later.",
  invalid_response: "Act! returned an unexpected response.",
  pagination_stalled: "Act! pagination did not make forward progress.",
};

export class ActApiError extends Error {
  constructor(
    readonly code: ActApiErrorCode,
    readonly retryable: boolean,
    readonly retryAfter: string | null = null,
    readonly writeOutcome: ActWriteOutcome = "unknown",
  ) {
    super(safeMessages[code]);
    this.name = "ActApiError";
  }

  withWriteOutcome(writeOutcome: ActWriteOutcome) {
    return new ActApiError(
      this.code,
      this.retryable,
      this.retryAfter,
      writeOutcome,
    );
  }
}
