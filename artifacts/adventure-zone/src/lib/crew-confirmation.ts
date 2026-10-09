/** Calendar-day age only; loading or looking up a place never confirms a fact. */
export function confirmationLabel(fact: string, confirmedOn?: string | null, now = new Date()): string {
  if (fact === "unknown" || !confirmedOn) return "Not confirmed by staff";
  const day = new Date(`${confirmedOn}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(confirmedOn) || !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== confirmedOn) return "Not confirmed by staff";
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const age = Math.floor((today - day.getTime()) / 86_400_000);
  if (age < 0) return "Not confirmed by staff";
  return `Staff confirmed ${confirmedOn} · ${age === 0 ? "today" : `${age} day${age === 1 ? "" : "s"} ago`}`;
}
