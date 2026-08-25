import { apiFetch } from "@/lib/auth-token";

export type GoogleHistoricalRetryResult = {
  attempted: number;
  attached: number;
  ignored: number;
  needsReview: number;
  failed: number;
};

export async function retryGoogleHistoricalFailures(): Promise<GoogleHistoricalRetryResult> {
  const response = await apiFetch("/google-workspace/historical-gmail/retry-failures", {
    method: "POST",
    body: "{}",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code =
      body && typeof body === "object" && "error" in body && typeof body.error === "string"
        ? body.error
        : `API ${response.status}`;
    throw new Error(code);
  }
  return body as GoogleHistoricalRetryResult;
}
