import type { SpendingSummary } from "@/components/assistant-workspace/SpendingControls";

export const spendingSummary: SpendingSummary = {
  version: 1,
  dailyLimitUsd: 1,
  monthlyLimitUsd: 30,
  monthlySpentUsd: 0.1,
  monthlyRemainingUsd: 29.7,
  monthlyResetAt: "2026-10-01T00:00:00.000Z",
  economyMode: true,
  day: "2026-09-26",
  resetAt: "2026-09-27T00:00:00.000Z",
  trackingStartedAt: "2026-09-26T12:00:00.000Z",
  spentUsd: 0.1,
  reservedUsd: 0.2,
  remainingUsd: 0.7,
  paused: false,
  currency: "USD",
  unknownCalls: 0,
  economyModel: null,
};
