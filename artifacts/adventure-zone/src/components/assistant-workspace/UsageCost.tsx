import type { UsageCost } from "@/features/assistant-workspace/types";

function amount(cost?: UsageCost): string {
  if (
    !cost ||
    cost.status === "unavailable" ||
    cost.estimatedUsd === null ||
    !Number.isFinite(cost.estimatedUsd)
  )
    return "unavailable";
  const dollars =
    cost.estimatedUsd > 0 && cost.estimatedUsd < 0.0001
      ? "<$0.0001"
      : new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 4,
          maximumFractionDigits: 4,
        }).format(cost.estimatedUsd);
  return `${dollars}${cost.status === "partial" ? " (partial)" : ""}`;
}

export function UsageCostSummary({
  latest,
  conversation,
}: {
  latest?: UsageCost;
  conversation?: UsageCost;
}) {
  const excluded = [
    ...new Set([
      ...(latest?.excluded ?? []),
      ...(conversation?.excluded ?? []),
    ]),
  ];
  return (
    <details className="border-t px-3 py-2 text-xs text-slate-600 sm:px-4">
      <summary className="min-h-11 cursor-pointer py-2 leading-relaxed">
        <span className="font-medium">Estimated AI cost (USD)</span>
        <span className="block sm:ml-3 sm:inline">
          Latest reply: {amount(latest)}
        </span>
        <span className="block sm:ml-3 sm:inline">
          Conversation: {amount(conversation)}
        </span>
      </summary>
      <div className="space-y-2 pb-2 leading-relaxed">
        <p>
          Based on recorded model usage and dated pricing. OpenAI billing is
          authoritative. This covers this conversation, not your whole API
          account.
        </p>
        <p>
          Older runs may not include cost measurements. Interrupted calls can
          incur charges that were not recorded here.
        </p>
        {excluded.length > 0 && (
          <ul className="list-disc space-y-1 pl-4">
            {excluded.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
