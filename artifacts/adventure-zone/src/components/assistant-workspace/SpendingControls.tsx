import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { workspaceApi } from "@/features/assistant-workspace/api";
import { modelLabel } from "@/features/assistant-workspace/model-labels";

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
  economyModel: string | null;
};

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
const button =
  "min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-2 text-[16px] font-medium disabled:opacity-50";

export function SpendingControls({
  active = false,
  refreshKey,
  onSummary,
  onEconomyEnabled,
}: {
  active?: boolean;
  refreshKey?: string;
  onSummary?: (summary: SpendingSummary) => void;
  onEconomyEnabled?: (model: string | null) => void;
}) {
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [dailyLimit, setDailyLimit] = useState("");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [economyMode, setEconomyMode] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [open, setOpen] = useState(false);
  const summaryRef = useRef<SpendingSummary | null>(null);
  const edited = useRef(false);
  const editingVersion = useRef<number | null>(null);
  const mounted = useRef(false);
  const request = useRef(0);
  const savingRef = useRef(false);
  const readingRef = useRef(false);
  const refreshAfterRead = useRef(false);
  const callbacks = useRef({ onSummary, onEconomyEnabled });
  callbacks.current = { onSummary, onEconomyEnabled };

  const accept = useCallback((value: SpendingSummary, replaceEdits = false) => {
    if (
      !value ||
      value.currency !== "USD" ||
      !Number.isInteger(value.version) ||
      ![
        value.dailyLimitUsd,
        value.monthlyLimitUsd,
        value.monthlySpentUsd,
        value.monthlyRemainingUsd,
        value.spentUsd,
        value.reservedUsd,
        value.remainingUsd,
      ].every((amount) => Number.isFinite(amount) && amount >= 0) ||
      typeof value.economyMode !== "boolean" ||
      typeof value.paused !== "boolean" ||
      !Number.isFinite(Date.parse(value.resetAt)) ||
      !Number.isFinite(Date.parse(value.monthlyResetAt)) ||
      !Number.isFinite(Date.parse(value.trackingStartedAt))
    )
      throw new Error("ASSISTANT_SPENDING_INVALID_RESPONSE");
    summaryRef.current = value;
    setSummary(value);
    callbacks.current.onSummary?.(value);
    if (!edited.current || replaceEdits) {
      edited.current = false;
      editingVersion.current = value.version;
      setDailyLimit(value.dailyLimitUsd.toFixed(2));
      setMonthlyLimit(value.monthlyLimitUsd.toFixed(2));
      setEconomyMode(value.economyMode);
    }
  }, []);

  const refresh = useCallback(
    async function loadUsage(): Promise<void> {
      if (!navigator.onLine || savingRef.current) return;
      if (readingRef.current) {
        refreshAfterRead.current = true;
        return;
      }
      readingRef.current = true;
      const generation = ++request.current;
      setLoading(true);
      try {
        const value = await workspaceApi<SpendingSummary>("/spending");
        if (!mounted.current || request.current !== generation) return;
        accept(value);
        // A background refresh must not erase a failed save or conflict notice.
        if (!edited.current) setError("");
      } catch {
        if (mounted.current && request.current === generation)
          setError(
            "Spending usage could not be refreshed. Connect and try again.",
          );
      } finally {
        readingRef.current = false;
        if (mounted.current && request.current === generation)
          setLoading(false);
        if (refreshAfterRead.current) {
          refreshAfterRead.current = false;
          if (mounted.current) void loadUsage();
        }
      }
    },
    [accept],
  );

  useEffect(() => {
    mounted.current = true;
    const connectivity = () => {
      setOnline(navigator.onLine);
      // Invalidate a pending read when the connection drops. Reconnect only
      // refreshes usage; it never submits edits or starts assistant work.
      if (!navigator.onLine && !savingRef.current) {
        request.current++;
        setLoading(false);
      }
    };
    window.addEventListener("online", connectivity);
    window.addEventListener("offline", connectivity);
    return () => {
      mounted.current = false;
      request.current++;
      window.removeEventListener("online", connectivity);
      window.removeEventListener("offline", connectivity);
    };
  }, []);

  useEffect(() => {
    if (online) void refresh();
    if (!online || !active) return;
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [online, active, refreshKey, refresh]);

  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!online || !summary) return;
    const delay = Math.max(
      60_000,
      Math.min(86_400_000, Date.parse(summary.resetAt) - Date.now() + 1000),
    );
    const timer = window.setTimeout(() => void refresh(), delay);
    return () => window.clearTimeout(timer);
  }, [online, summary?.resetAt, refresh]);

  function beginEdit() {
    if (!edited.current)
      editingVersion.current = summaryRef.current?.version ?? null;
    edited.current = true;
    setNotice("");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (
      !online ||
      !navigator.onLine ||
      savingRef.current ||
      !summaryRef.current ||
      conflict
    )
      return;
    const amount = Number(dailyLimit);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(dailyLimit.trim()) ||
      !Number.isFinite(amount) ||
      amount < 0 ||
      amount > 1000
    ) {
      setError(
        "Enter a daily limit from $0 to $1,000, with up to two decimal places.",
      );
      return;
    }
    const monthlyAmount = Number(monthlyLimit);
    if (
      !/^\d+(?:\.\d{1,2})?$/.test(monthlyLimit.trim()) ||
      !Number.isFinite(monthlyAmount) ||
      monthlyAmount < 0 ||
      monthlyAmount > 1000
    ) {
      setError(
        "Enter a monthly limit from $0 to $1,000, with up to two decimal places.",
      );
      return;
    }
    const version = editingVersion.current;
    if (version === null) return;
    const enabledEconomy = economyMode && !summaryRef.current.economyMode;
    const economyCallback = callbacks.current.onEconomyEnabled;
    savingRef.current = true;
    setSaving(true);
    setLoading(false);
    setError("");
    setNotice("");
    const generation = ++request.current;
    try {
      const value = await workspaceApi<SpendingSummary>("/spending", "PATCH", {
        version,
        dailyLimitUsd: amount,
        monthlyLimitUsd: monthlyAmount,
        economyMode,
      });
      if (!mounted.current || request.current !== generation) return;
      accept(value, true);
      setConflict(false);
      setNotice(
        value.paused
          ? "Saved. Paid AI work is paused."
          : "Spending settings saved. Send a message when you are ready.",
      );
      if (enabledEconomy) economyCallback?.(value.economyModel);
    } catch (cause) {
      if (!mounted.current || request.current !== generation) return;
      if (
        cause instanceof Error &&
        cause.message.includes("SPENDING_CONFLICT")
      ) {
        setConflict(true);
        setError(
          "These settings changed elsewhere. Your edits are still here. Review the current settings before saving again.",
        );
      } else {
        setError(
          "Spending settings could not be saved. Your edits are still here; refresh usage and try again.",
        );
      }
    } finally {
      savingRef.current = false;
      if (mounted.current && request.current === generation) setSaving(false);
    }
  }

  async function reviewCurrent() {
    if (!online || savingRef.current) return;
    const generation = ++request.current;
    setLoading(true);
    try {
      const value = await workspaceApi<SpendingSummary>("/spending");
      if (!mounted.current || request.current !== generation) return;
      accept(value);
      // Keep the user's form, but show the values/version they must review.
      editingVersion.current = value.version;
      setConflict(false);
      setError("");
      setNotice(
        `Current setting: ${money(value.dailyLimitUsd)} per day, ${money(value.monthlyLimitUsd)} per month, Economy ${value.economyMode ? "on" : "off"}. Your edits are shown below. Review them, then save to replace these settings.`,
      );
    } catch {
      if (mounted.current && request.current === generation)
        setError(
          "Current settings could not be loaded. Your edits are still here.",
        );
    } finally {
      if (mounted.current && request.current === generation) setLoading(false);
    }
  }

  return (
    <section
      id="assistant-spending"
      aria-label="Assistant spending"
      className="my-3 min-w-0 rounded-xl border bg-white p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-950">Spending controls</h2>
          {summary ? (
            <p className="mt-1 text-slate-700">
              {summary.paused
                ? "Paid AI paused"
                : `${money(summary.remainingUsd)} available`}{" "}
              · {money(summary.dailyLimitUsd)} daily limit ·{" "}
              {money(summary.monthlyLimitUsd)} monthly limit
              {summary.economyMode ? " · Economy on" : ""}
            </p>
          ) : (
            <p role="status" className="mt-1 text-slate-600">
              {online && loading
                ? "Loading spending…"
                : "Spending usage unavailable"}
            </p>
          )}
        </div>
        <button
          type="button"
          className={button}
          aria-expanded={open}
          aria-controls="assistant-spending-editor"
          onClick={() => setOpen(!open)}
        >
          {open ? "Hide spending controls" : "Adjust spending"}
        </button>
      </div>
      {!online && (
        <p className="mt-2 text-amber-900">
          Offline: spending settings are read-only. Any amounts shown were last
          checked online.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-red-800">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-2 text-teal-900">
          {notice}
        </p>
      )}
      {summary?.paused && (
        <p className="mt-2 text-amber-900">
          New paid work is paused. You can adjust your limits. Usage resets each
          day and month; unconfirmed request holds carry over. Nothing resumes
          automatically.
        </p>
      )}
      <div
        id="assistant-spending-editor"
        hidden={!open}
        className="mt-3 space-y-3"
      >
        {summary && (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
              <div>
                <dt className="text-slate-600">Used today · estimated</dt>
                <dd className="font-semibold">{money(summary.spentUsd)}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Held for requests</dt>
                <dd className="font-semibold">{money(summary.reservedUsd)}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Available</dt>
                <dd className="font-semibold">{money(summary.remainingUsd)}</dd>
              </div>
              <div>
                <dt className="text-slate-600">Used this month · estimated</dt>
                <dd className="font-semibold">
                  {money(summary.monthlySpentUsd)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-600">Monthly allowance remaining</dt>
                <dd className="font-semibold">
                  {money(summary.monthlyRemainingUsd)}
                </dd>
              </div>
            </dl>
            <form onSubmit={(event) => void save(event)} className="space-y-3">
              <label className="block max-w-sm font-medium">
                Daily spending limit (USD)
                <input
                  value={dailyLimit}
                  onChange={(event) => {
                    beginEdit();
                    setDailyLimit(event.target.value);
                  }}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!online || saving}
                  aria-describedby="assistant-spending-limit-help"
                  className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-[16px] disabled:opacity-60"
                />
              </label>
              <label className="block max-w-sm font-medium">
                Monthly spending limit (USD)
                <input
                  value={monthlyLimit}
                  onChange={(event) => {
                    beginEdit();
                    setMonthlyLimit(event.target.value);
                  }}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  disabled={!online || saving}
                  aria-describedby="assistant-spending-limit-help"
                  className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 py-2 text-[16px] disabled:opacity-60"
                />
              </label>
              <p id="assistant-spending-limit-help" className="text-slate-600">
                Set either limit to $0 to pause paid AI. Both limits apply
                across all chats. You control these limits; the assistant cannot
                raise them.
              </p>
              <label className="flex min-h-11 cursor-pointer items-center gap-3 text-[16px] font-medium">
                <input
                  type="checkbox"
                  checked={economyMode}
                  onChange={(event) => {
                    beginEdit();
                    setEconomyMode(event.target.checked);
                  }}
                  disabled={!online || saving}
                  className="h-5 w-5 accent-teal-800"
                />
                Economy mode
              </label>
              <p className="text-slate-600">
                {summary.economyModel
                  ? `Economy uses ${modelLabel(summary.economyModel)} for new chats and lower-cost research. You can still choose a different chat model.`
                  : "No Economy model is configured. Your selected model remains in use, with the same spending limit."}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  className={`${button} border-teal-800 bg-teal-800 text-white`}
                  disabled={!online || saving || conflict || !edited.current}
                >
                  {saving
                    ? "Saving spending settings…"
                    : "Save spending settings"}
                </button>
                {conflict && (
                  <button
                    type="button"
                    className={button}
                    disabled={!online || loading || saving}
                    onClick={() => void reviewCurrent()}
                  >
                    Review current settings
                  </button>
                )}
              </div>
            </form>
            <details className="rounded-lg bg-slate-50 p-3 text-slate-700">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                How this budget works
              </summary>
              <div className="space-y-2">
                <p>
                  Tracks this assistant from{" "}
                  {new Date(summary.trackingStartedAt).toLocaleString()}.
                  Earlier spending and other apps are not included; this is not
                  your full OpenAI invoice.
                </p>
                <p>
                  Resets {new Date(summary.resetAt).toLocaleString()} (your
                  local time), at the start of each UTC day. Monthly usage
                  resets {new Date(summary.monthlyResetAt).toLocaleString()}{" "}
                  (your local time), at the start of each UTC month.
                </p>
                <p>
                  We hold a conservative estimate before a request starts. Work
                  can pause if the next request will not fit. Lowering the limit
                  does not cancel charges from work already started.
                </p>
                {!!summary.unknownCalls && (
                  <p>
                    {summary.unknownCalls} request(s) have unconfirmed usage.
                    Their held amounts remain reserved across daily resets.
                  </p>
                )}
              </div>
            </details>
          </>
        )}
        <button
          type="button"
          className={button}
          disabled={!online || loading || saving}
          onClick={() => void refresh()}
        >
          {loading ? "Refreshing spending…" : "Refresh spending usage"}
        </button>
      </div>
    </section>
  );
}
