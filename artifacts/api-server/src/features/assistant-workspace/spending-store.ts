import type { Queryable } from "./contracts";
import { transactionQueries } from "./transaction-queries";

export type SpendingScope = {
  actorId: string;
  conversationId: string;
  runId: string;
  /** Globally unique durable provider-call identity, including the run and step. */
  callId: string;
  source: "assistant" | "research" | "document";
  model: string;
};
export type SpendingSummary = {
  version: number;
  dailyLimitUsd: number;
  monthlyLimitUsd: number;
  monthlySpentUsd: number;
  monthlyRemainingUsd: number;
  monthlyResetAt: string;
  economyMode: boolean;
  day: string;
  resetAt: string;
  trackingStartedAt: string;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  paused: boolean;
  currency: "USD";
  unknownCalls: number;
};
export type SpendingUpdate = {
  version: number;
  dailyLimitUsd: number;
  monthlyLimitUsd?: number;
  economyMode: boolean;
};
type TransactionDatabase = {
  transaction<T>(work: (tx: any) => Promise<T>): Promise<T>;
};
type Settings = {
  actor_id: string;
  version: number;
  daily_limit_nanos: string | number;
  monthly_limit_nanos: string | number;
  economy_mode: boolean;
  tracking_started_at: Date | string;
};
const NANOS_PER_USD = 1_000_000_000;
const invalid = () => new Error("ASSISTANT_SPENDING_INVALID");
const validText = (value: unknown, max = 500): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;
const validUuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validNanos = (value: number, allowZero: boolean) =>
  Number.isSafeInteger(value) && value >= (allowZero ? 0 : 1);
const usd = (amount: bigint) => Number(amount) / NANOS_PER_USD;
function dayAt(now: Date) {
  const day = now.toISOString().slice(0, 10);
  const reset = new Date(`${day}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);
  const monthStart = `${day.slice(0, 7)}-01`;
  const monthlyReset = new Date(`${monthStart}T00:00:00.000Z`);
  monthlyReset.setUTCMonth(monthlyReset.getUTCMonth() + 1);
  return {
    day,
    resetAt: reset.toISOString(),
    monthStart,
    monthlyResetAt: monthlyReset.toISOString(),
  };
}

/**
 * This ledger covers assistant calls made after tracking starts, not an imported
 * provider invoice. Every writer locks the actor's settings row on its pinned
 * transaction connection before inspecting or changing reservations.
 */
export class SpendingStore {
  constructor(
    private readonly database: TransactionDatabase,
    _queries: Queryable,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private async locked<T>(
    actorId: string,
    work: (q: Queryable, settings: Settings, now: Date) => Promise<T>,
  ): Promise<T> {
    if (!validText(actorId)) throw invalid();
    return this.database.transaction(async (tx) => {
      const q = transactionQueries(tx);
      await q.query(
        `INSERT INTO assistant_workspace_spending_settings(actor_id,tracking_started_at,updated_at)
         VALUES($1,$2,$2) ON CONFLICT(actor_id) DO NOTHING`,
        [actorId, this.clock().toISOString()],
      );
      const row = await q.query(
        `SELECT * FROM assistant_workspace_spending_settings WHERE actor_id=$1 FOR UPDATE`,
        [actorId],
      );
      if (!row.rows[0]) throw invalid();
      // Take the day after acquiring the lock, including when waiting at midnight.
      return work(q, row.rows[0] as Settings, this.clock());
    });
  }

  private async totals(q: Queryable, actorId: string, day: string) {
    const result = await q.query(
      `SELECT
        COALESCE(SUM(charged_nanos) FILTER (WHERE state='settled' AND budget_day=$2::date),0)::text AS spent,
        COALESCE(SUM(charged_nanos) FILTER (WHERE state='settled' AND budget_day >= $3::date AND budget_day < ($3::date + INTERVAL '1 month')),0)::text AS monthly_spent,
        COALESCE(SUM(reserved_nanos) FILTER (WHERE state IN ('reserved','uncertain')),0)::text AS reserved,
        COUNT(*) FILTER (WHERE state='uncertain')::integer AS unknown_calls
       FROM assistant_workspace_spending_calls WHERE actor_id=$1`,
      [actorId, day, `${day.slice(0, 7)}-01`],
    );
    const row = result.rows[0];
    return {
      spent: BigInt(row.spent),
      monthlySpent: BigInt(row.monthly_spent),
      reserved: BigInt(row.reserved),
      unknownCalls: Number(row.unknown_calls),
    };
  }

  private async describe(
    q: Queryable,
    settings: Settings,
    now: Date,
  ): Promise<SpendingSummary> {
    const { day, resetAt, monthlyResetAt } = dayAt(now);
    const totals = await this.totals(q, settings.actor_id, day);
    const limit = BigInt(settings.daily_limit_nanos);
    const monthlyLimit = BigInt(settings.monthly_limit_nanos);
    const dailyAvailable = limit - totals.spent - totals.reserved;
    const monthlyAvailable =
      monthlyLimit - totals.monthlySpent - totals.reserved;
    const available =
      dailyAvailable < monthlyAvailable ? dailyAvailable : monthlyAvailable;
    return {
      version: settings.version,
      dailyLimitUsd: usd(limit),
      monthlyLimitUsd: usd(monthlyLimit),
      monthlySpentUsd: usd(totals.monthlySpent),
      monthlyRemainingUsd: usd(monthlyAvailable > 0n ? monthlyAvailable : 0n),
      monthlyResetAt,
      economyMode: settings.economy_mode,
      day,
      resetAt,
      trackingStartedAt: new Date(settings.tracking_started_at).toISOString(),
      spentUsd: usd(totals.spent),
      reservedUsd: usd(totals.reserved),
      remainingUsd: usd(available > 0n ? available : 0n),
      paused: available <= 0n,
      currency: "USD",
      unknownCalls: totals.unknownCalls,
    };
  }

  async summary(actorId: string): Promise<SpendingSummary> {
    return this.locked(actorId, (q, settings, now) =>
      this.describe(q, settings, now),
    );
  }

  async update(
    actorId: string,
    input: SpendingUpdate,
  ): Promise<SpendingSummary> {
    const cents = input.dailyLimitUsd * 100;
    if (
      !Number.isSafeInteger(input.version) ||
      input.version < 1 ||
      typeof input.dailyLimitUsd !== "number" ||
      typeof input.economyMode !== "boolean" ||
      !Number.isFinite(cents) ||
      input.dailyLimitUsd < 0 ||
      input.dailyLimitUsd > 1000 ||
      Math.abs(cents - Math.round(cents)) > 0.0000001
    )
      throw invalid();
    const monthlyCents =
      input.monthlyLimitUsd === undefined
        ? undefined
        : input.monthlyLimitUsd * 100;
    if (
      monthlyCents !== undefined &&
      (typeof input.monthlyLimitUsd !== "number" ||
        !Number.isFinite(monthlyCents) ||
        input.monthlyLimitUsd < 0 ||
        input.monthlyLimitUsd > 1000 ||
        Math.abs(monthlyCents - Math.round(monthlyCents)) > 0.0000001)
    )
      throw invalid();
    const limit = Math.round(cents) * 10_000_000;
    return this.locked(actorId, async (q, settings, now) => {
      if (settings.version !== input.version)
        throw new Error("ASSISTANT_SPENDING_CONFLICT");
      const result = await q.query(
        `UPDATE assistant_workspace_spending_settings
         SET daily_limit_nanos=$2,economy_mode=$3,version=version+1,updated_at=$4,monthly_limit_nanos=$5
         WHERE actor_id=$1 RETURNING *`,
        [
          actorId,
          limit,
          input.economyMode,
          now.toISOString(),
          monthlyCents === undefined
            ? settings.monthly_limit_nanos
            : Math.round(monthlyCents) * 10_000_000,
        ],
      );
      return this.describe(q, result.rows[0] as Settings, now);
    });
  }

  async reserve(scope: SpendingScope, amountNanos: number): Promise<void> {
    if (
      !validNanos(amountNanos, false) ||
      !validText(scope.callId, 1000) ||
      !validText(scope.model, 200) ||
      !validUuid(scope.conversationId) ||
      !validUuid(scope.runId) ||
      !["assistant", "research", "document"].includes(scope.source)
    )
      throw invalid();
    return this.locked(scope.actorId, async (q, settings, now) => {
      const owned = await q.query(
        `SELECT r.id FROM assistant_workspace_runs r
         JOIN assistant_workspace_conversations c ON c.id=r.conversation_id AND c.actor_id=r.actor_id
         WHERE r.id=$1 AND r.conversation_id=$2 AND r.actor_id=$3 AND c.lifecycle='active'
         AND r.status='running' AND r.cancel_requested_at IS NULL`,
        [scope.runId, scope.conversationId, scope.actorId],
      );
      if (!owned.rows.length) throw invalid();
      const task = (
        await q.query(
          `SELECT t.id,t.state,t.scope FROM assistant_profile_tasks t JOIN assistant_profile_task_runs b ON b.task_id=t.id WHERE b.run_id=$1 AND t.actor_id=$2 FOR UPDATE OF t`,
          [scope.runId, scope.actorId],
        )
      ).rows[0];
      if (task) {
        if (task.state !== "running") throw new Error("ASSISTANT_TASK_PAUSED");
        if (
          task.scope.taskCapUsd !== null &&
          task.scope.taskCapUsd !== undefined
        ) {
          const total = (
            await q.query(
              `SELECT COALESCE(SUM(CASE WHEN s.state='settled' THEN s.charged_nanos ELSE s.reserved_nanos END),0)::text AS amount FROM assistant_workspace_spending_calls s JOIN assistant_profile_task_runs b ON b.run_id=s.run_id WHERE b.task_id=$1`,
              [task.id],
            )
          ).rows[0];
          if (
            BigInt(total.amount) + BigInt(amountNanos) >
            BigInt(Math.round(task.scope.taskCapUsd * NANOS_PER_USD))
          )
            throw new Error("ASSISTANT_BUDGET_LIMIT");
        }
      }
      const existing = await q.query(
        `SELECT call_id FROM assistant_workspace_spending_calls WHERE call_id=$1`,
        [scope.callId],
      );
      if (existing.rows.length) throw new Error("ASSISTANT_BUDGET_CALL_EXISTS");
      const { day } = dayAt(now);
      const totals = await this.totals(q, scope.actorId, day);
      const limit = BigInt(settings.daily_limit_nanos);
      if (
        limit === 0n ||
        totals.spent + totals.reserved + BigInt(amountNanos) > limit ||
        totals.monthlySpent + totals.reserved + BigInt(amountNanos) >
          BigInt(settings.monthly_limit_nanos)
      )
        throw new Error("ASSISTANT_BUDGET_LIMIT");
      const inserted = await q.query(
        `INSERT INTO assistant_workspace_spending_calls
         (call_id,actor_id,conversation_id,run_id,source,model,budget_day,reserved_nanos,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,$9,$9)
         ON CONFLICT(call_id) DO NOTHING RETURNING call_id`,
        [
          scope.callId,
          scope.actorId,
          scope.conversationId,
          scope.runId,
          scope.source,
          scope.model,
          day,
          amountNanos,
          now.toISOString(),
        ],
      );
      if (!inserted.rows.length)
        throw new Error("ASSISTANT_BUDGET_CALL_EXISTS");
    });
  }

  async settle(
    actorId: string,
    callId: string,
    chargedNanos: number | null,
  ): Promise<void> {
    if (
      !validText(callId, 1000) ||
      (chargedNanos !== null && !validNanos(chargedNanos, true))
    )
      throw invalid();
    return this.locked(actorId, async (q, _settings, now) => {
      const existing = await q.query(
        `SELECT state,charged_nanos FROM assistant_workspace_spending_calls WHERE actor_id=$1 AND call_id=$2 FOR UPDATE`,
        [actorId, callId],
      );
      const row = existing.rows[0];
      if (!row) throw invalid();
      if (chargedNanos === null) {
        // A lost/unknown provider result cannot release the reservation, and a
        // later uncertain retry must not erase an already verified charge.
        if (row.state !== "settled")
          await q.query(
            `UPDATE assistant_workspace_spending_calls SET state='uncertain',updated_at=$3 WHERE actor_id=$1 AND call_id=$2`,
            [actorId, callId, now.toISOString()],
          );
        return;
      }
      if (
        row.state === "settled" &&
        BigInt(row.charged_nanos) >= BigInt(chargedNanos)
      )
        return;
      await q.query(
        `UPDATE assistant_workspace_spending_calls SET state='settled',charged_nanos=$3,updated_at=$4
         WHERE actor_id=$1 AND call_id=$2`,
        [actorId, callId, chargedNanos, now.toISOString()],
      );
    });
  }
}
