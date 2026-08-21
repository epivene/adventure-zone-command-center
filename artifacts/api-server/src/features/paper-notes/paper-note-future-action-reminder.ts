export type RecoveredPaperNoteFutureAction = {
  text: string;
  method: "call" | "email" | "mail" | "text" | null;
};

export const POTENTIAL_BOOKING_NEXT_YEAR_NOTE = "Potential booking — reach out next year.";

function cleanClause(value: string) {
  return value
    .trim()
    .replace(/^[\s:;,./\\|]+/, "")
    .replace(/[\s.!?;,]+$/, "")
    .trim();
}

function actionMethod(value: string): RecoveredPaperNoteFutureAction["method"] | undefined {
  const lower = value.toLowerCase();
  if (/^send\s+(?:an?\s+)?e-?mail\b/.test(lower)) return "email";
  if (/^email(?:$|\s+(?!address\b))/.test(lower)) return "email";
  if (/^send\s+(?:a\s+)?text\b/.test(lower)) return "text";
  if (/^text(?:$|\s+(?!number\b))/.test(lower)) return "text";
  if (/^(?:call\s+back\b|call\b(?!\s+of\b))/.test(lower)) return "call";
  if (/^mail(?:$|\s+(?!address\b))/.test(lower)) return "mail";
  if (/^(?:follow\s*up\b|check\s+back\b|reach\s+out\b)/.test(lower)) return null;
  if (/^send\s+(?:the\s+)?(?:packet|brochure|flyer|letter|contract|proposal|info(?:rmation)?|materials?)\b/.test(lower)) return null;
  return undefined;
}

export function recoverPaperNoteFutureActionReminder(
  transcription: string | null | undefined,
): RecoveredPaperNoteFutureAction | null {
  const source = transcription?.trim();
  if (!source) return null;

  const clauses = source
    .split(/\s+(?:[-–—]|\||;)\s+|(?<=[.!?])\s+/)
    .map(cleanClause)
    .filter(Boolean);

  for (let index = clauses.length - 1; index >= 0; index -= 1) {
    const clause = clauses[index]!;
    if (clause.length > 120) continue;
    if (/^(?:emailed|sent\s+(?:an?\s+)?e-?mail|called|mailed|texted|followed\s+up)\b/i.test(clause)) continue;
    if (/^(?:email|call|text|mail)\s+(?:sent|completed|made|done)\b/i.test(clause)) continue;

    const method = actionMethod(clause);
    if (method !== undefined) return { text: clause, method };
  }

  return null;
}

export function paperNoteSuggestsPotentialBooking(input: {
  transcription?: string | null;
  oldReminder?: string | null;
  outcome?: string | null;
  summary?: string | null;
  generalNotes?: string[];
}) {
  if (input.generalNotes?.some((note) => note.trim() === POTENTIAL_BOOKING_NEXT_YEAR_NOTE)) return true;

  const reminder = input.oldReminder?.trim();
  if (reminder && actionMethod(reminder) !== undefined) return true;
  if (recoverPaperNoteFutureActionReminder(input.transcription)) return true;

  const text = [input.transcription, input.oldReminder, input.outcome, input.summary]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (!text) return false;
  if (/\bnot interested\b|\bdo not contact\b|\bdo not call\b/.test(text)) return false;

  return /\b(?:interested|possible booking|possible event|maybe next year|try again(?: next year)?|contact next year|call next year|reach out next year|send (?:more )?(?:info|information|details|proposal|contract))\b/.test(text);
}
