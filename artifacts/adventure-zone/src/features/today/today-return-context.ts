export type TodayReturnContext = {
  filter: string | null;
  workItemId: string | null;
  scrollY: number;
};

const STORAGE_KEY = "adventure-zone:today-return-context";
const EXPECTED_KEYS = ["filter", "scrollY", "workItemId"];

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isTodayReturnContext(value: unknown): value is TodayReturnContext {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("|") !== EXPECTED_KEYS.join("|")) return false;
  return (
    isNullableString(record.filter) &&
    isNullableString(record.workItemId) &&
    typeof record.scrollY === "number" &&
    Number.isFinite(record.scrollY) &&
    record.scrollY >= 0
  );
}

export function saveTodayReturnContext(value: TodayReturnContext): void {
  if (!isTodayReturnContext(value)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Navigation must continue even if storage is blocked.
  }
}

export function readTodayReturnContext(): TodayReturnContext | null {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;
    const parsed: unknown = JSON.parse(stored);
    return isTodayReturnContext(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearTodayReturnContext(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else to clear.
  }
}
