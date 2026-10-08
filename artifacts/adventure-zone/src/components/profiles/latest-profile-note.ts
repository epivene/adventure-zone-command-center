import { historyCategory, htmlToPlainText, type ProfileHistoryItem } from "./history-summary";

export type DatedProfileNote = ProfileHistoryItem & {
  id: string;
  occurredAt?: Date | string | null;
  createdAt?: Date | string | null;
  historicalDateUnknown?: boolean;
};

export function profileNoteTime(note: DatedProfileNote) {
  if (note.historicalDateUnknown) return 0;
  const occurred = new Date(note.occurredAt ?? "").getTime();
  const created = new Date(note.createdAt ?? "").getTime();
  return Number.isFinite(occurred) ? occurred : Number.isFinite(created) ? created : 0;
}

export function latestProfileNote<T extends DatedProfileNote>(notes: T[]): T | null {
  return [...notes]
    .filter(note => historyCategory(note) === "notes" && htmlToPlainText(note.body ?? "").trim())
    .sort((left, right) => profileNoteTime(right) - profileNoteTime(left))[0] ?? null;
}
