import type OpenAI from "openai";
import type { ResponseCreateParams } from "openai/resources/responses/responses";
import type { InputTokenCountParams } from "openai/resources/responses/input-tokens";
import type { SpendingScope } from "./spending-store";
import {
  canonicalSpendingModel,
  SEARCH_CONTEXT,
  SEARCH_CALL_NANOS,
  spendingRate,
  spendingContextLimit,
} from "./spending-policy";

export type SpendingPort = {
  summary(actorId: string): Promise<{ economyMode: boolean }>;
  reserve(scope: SpendingScope, amountNanos: number): Promise<void>;
  settle(
    actorId: string,
    callId: string,
    chargedNanos: number | null,
  ): Promise<void>;
};
// The installed SDK accepts this documented Responses property at runtime but
// has not yet added it to ResponseCreateParams.
export type PaidResponseRequest = ResponseCreateParams & {
  max_tool_calls?: number;
};
export class SpendingPreflightError extends Error {
  constructor(
    message: string,
    readonly safeToRetry = true,
  ) {
    super(message);
  }
}
export function isSpendingPreflightError(
  error: unknown,
): error is SpendingPreflightError {
  return error instanceof SpendingPreflightError;
}
export function isSpendingError(error: unknown): error is Error {
  return (
    error instanceof Error &&
    (error instanceof SpendingPreflightError ||
      /^ASSISTANT_(?:BUDGET_|SPENDING_)/.test(error.message))
  );
}
const count = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
function invalid(code: string): never {
  throw new SpendingPreflightError(code);
}
function checkPreflightSignal(signal: AbortSignal): void {
  if (signal.aborted) invalid("ASSISTANT_CANCELLED");
}
function amount(
  model: string,
  inputTokens: number,
  outputTokens: number,
  contextTokens = inputTokens,
): number {
  const rate = spendingRate(model, contextTokens);
  if (!rate) invalid("ASSISTANT_SPENDING_MODEL_UNPRICED");
  const total = inputTokens * rate.input + outputTokens * rate.output;
  if (!Number.isSafeInteger(total) || total < 0)
    invalid("ASSISTANT_SPENDING_USAGE_INVALID");
  return total;
}
function countingRequest(request: ResponseCreateParams): InputTokenCountParams {
  // Only supported counting parameters. Include every field affecting the
  // actual prompt, including private image/file data and function schemas.
  return {
    model: request.model,
    input: request.input,
    instructions: request.instructions,
    tools: request.tools,
    tool_choice: request.tool_choice,
    parallel_tool_calls: request.parallel_tool_calls,
    reasoning: request.reasoning,
    text: request.text,
    ...(request.conversation ? { conversation: request.conversation } : {}),
    ...(request.previous_response_id
      ? { previous_response_id: request.previous_response_id }
      : {}),
  };
}

/** Reserve before generation; a failed/unknown generation keeps the full hold. */
export async function preparePaidResponse(
  client: OpenAI,
  spending: SpendingPort,
  scope: SpendingScope | undefined,
  request: PaidResponseRequest,
  signal: AbortSignal,
): Promise<{ finish(response?: unknown): Promise<void> }> {
  checkPreflightSignal(signal);
  if (client.baseURL.replace(/\/$/, "") !== "https://api.openai.com/v1")
    invalid("ASSISTANT_SPENDING_ENDPOINT_UNPRICED");
  if (
    !scope ||
    ![scope.actorId, scope.conversationId, scope.runId, scope.callId].every(
      (value) => typeof value === "string" && value.length > 0,
    )
  )
    invalid("ASSISTANT_SPENDING_SCOPE_REQUIRED");
  if (request.model !== scope.model || request.service_tier !== "default")
    invalid("ASSISTANT_SPENDING_REQUEST_INVALID");
  if (!spendingRate(scope.model, 0))
    invalid("ASSISTANT_SPENDING_MODEL_UNPRICED");
  const maxOutput = request.max_output_tokens;
  if (!count(maxOutput) || maxOutput < 1 || maxOutput > 128_000)
    invalid("ASSISTANT_SPENDING_OUTPUT_LIMIT_REQUIRED");
  const hosted = (request.tools ?? []).filter(
    (tool) => tool.type !== "function",
  );
  const hasSearch = hosted.some((tool) => tool.type === "web_search");
  if (hosted.some((tool) => tool.type !== "web_search"))
    invalid("ASSISTANT_SPENDING_TOOL_UNPRICED");
  const maxSearch = hasSearch ? request.max_tool_calls : 0;
  if (!count(maxSearch) || (hasSearch && (maxSearch < 1 || maxSearch > 3)))
    invalid("ASSISTANT_SPENDING_SEARCH_LIMIT_REQUIRED");
  let inputTokens: number;
  try {
    const result = await client.responses.inputTokens.count(
      countingRequest(request),
      { signal },
    );
    if (
      !count(result.input_tokens) ||
      result.input_tokens > spendingContextLimit(scope.model)!
    )
      invalid("ASSISTANT_SPENDING_INPUT_COUNT_INVALID");
    inputTokens = result.input_tokens;
  } catch (error) {
    checkPreflightSignal(signal);
    if (isSpendingError(error)) throw error;
    invalid("ASSISTANT_SPENDING_INPUT_COUNT_UNAVAILABLE");
  }
  const perRoundContext = inputTokens + maxOutput + SEARCH_CONTEXT;
  let reservedNanos: number;
  if (hasSearch) {
    // Hosted search can add input during generation. Its context cannot be
    // counted beforehand: reserve a full search context, all initial input,
    // and the entire output allowance for every possible model round.
    // Search content may be billed separately from response input telemetry.
    // Reserve an extra full search context per call; this deliberately may
    // double count content already included by the provider.
    reservedNanos =
      amount(
        scope.model,
        perRoundContext * (maxSearch + 1) + SEARCH_CONTEXT * maxSearch,
        maxOutput,
        perRoundContext,
      ) +
      SEARCH_CALL_NANOS * maxSearch;
  } else {
    reservedNanos = amount(scope.model, inputTokens, maxOutput);
  }
  checkPreflightSignal(signal);
  try {
    await spending.reserve(scope, reservedNanos);
  } catch (error) {
    if (isSpendingError(error))
      throw new SpendingPreflightError(
        error.message,
        error.message !== "ASSISTANT_BUDGET_CALL_EXISTS",
      );
    throw new SpendingPreflightError("ASSISTANT_SPENDING_UNAVAILABLE", false);
  }
  let finished = false;
  return {
    async finish(raw?: unknown) {
      if (finished) return;
      finished = true;
      const response = raw as any;
      let chargedNanos: number | null = null;
      if (
        response?.status === "completed" &&
        typeof response.id === "string" &&
        response.id.length > 0 &&
        typeof response.model === "string" &&
        canonicalSpendingModel(response.model) ===
          canonicalSpendingModel(scope.model) &&
        response.service_tier === "default" &&
        count(response.usage?.input_tokens) &&
        count(response.usage?.output_tokens) &&
        Array.isArray(response.output)
      ) {
        const searches = response.output.filter(
          (item: any) => item?.type === "web_search_call",
        );
        const supportedOutput = response.output.every((item: any) =>
          ["message", "reasoning", "function_call", "web_search_call"].includes(
            item?.type,
          ),
        );
        if (
          supportedOutput &&
          ((!hasSearch && searches.length === 0) ||
            (hasSearch &&
              searches.length > 0 &&
              searches.every((item: any) => item.status === "completed")))
        ) {
          try {
            chargedNanos =
              amount(
                response.model,
                response.usage.input_tokens + SEARCH_CONTEXT * searches.length,
                response.usage.output_tokens,
                hasSearch &&
                  response.usage.input_tokens <=
                    perRoundContext * (maxSearch + 1)
                  ? perRoundContext
                  : response.usage.input_tokens,
              ) +
              searches.length * SEARCH_CALL_NANOS;
            if (!Number.isSafeInteger(chargedNanos)) chargedNanos = null;
          } catch {
            /* Unknown pricing retains the hold. */
          }
        }
      }
      // No clipping to the reservation: an unexpected measured overrun must
      // remain visible and block future work, rather than disappear.
      // A storage failure leaves the durable reservation intact and is NOT a
      // preflight error: the provider may already have charged for this call.
      try {
        await spending.settle(scope.actorId, scope.callId, chargedNanos);
      } catch {
        throw new Error("ASSISTANT_PROVIDER_SETTLEMENT_UNAVAILABLE");
      }
    },
  };
}
