import type {
  PaperNoteExtraction,
  PaperNotePageSegmentation,
  PaperNoteWarning,
} from "./paper-note-extraction-schema";

const nameStopWords = new Set([
  "the", "of", "and", "event", "festival", "fair", "county", "co", "mt", "montana",
]);

function normalizedNameTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/\bco\b/g, "county")
    .replace(/\bmt\b/g, "montana")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function paperNoteNameSimilarity(left: string, right: string) {
  const leftTokens = normalizedNameTokens(left);
  const rightTokens = normalizedNameTokens(right);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  const union = new Set([...leftSet, ...rightSet]);
  const intersection = [...leftSet].filter((token) => rightSet.has(token));
  const tokenScore = intersection.length / union.size;

  const meaningfulLeft = leftTokens.filter((token) => !nameStopWords.has(token));
  const meaningfulRight = rightTokens.filter((token) => !nameStopWords.has(token));
  const meaningfulUnion = new Set([...meaningfulLeft, ...meaningfulRight]);
  const meaningfulIntersection = [...new Set(meaningfulLeft)].filter((token) => meaningfulRight.includes(token));
  const meaningfulScore = meaningfulUnion.size
    ? meaningfulIntersection.length / meaningfulUnion.size
    : tokenScore;

  return Math.max(tokenScore, meaningfulScore * 0.9 + tokenScore * 0.1);
}

function horizontalOverlap(left: NonNullable<PaperNotePageSegmentation["entries"][number]["region"]>, right: NonNullable<PaperNotePageSegmentation["entries"][number]["region"]>) {
  const overlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  return overlap / Math.max(0.001, Math.min(left.width, right.width));
}

function mergedRegion(left: NonNullable<PaperNotePageSegmentation["entries"][number]["region"]>, right: NonNullable<PaperNotePageSegmentation["entries"][number]["region"]>) {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottom = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottom - y };
}

function likelyContinuationText(text: string) {
  const value = text.trim();
  if (!value) return true;
  if (/^(call|called|send|sent|email|emailed|mail|mailed|text|texted|ask|left|no answer|voicemail|vm|maybe|interested|phone|cell|office|ext\.?|x\s*\d)/i.test(value)) return true;
  if (/^\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(value)) return true;
  if (/^[a-z][a-z .'-]{1,28}\s*[-–:]\s*/i.test(value) && !/\b(fair|festival|days|rodeo|carnival|celebration)\b/i.test(value)) return true;
  return false;
}

export function mergePaperNoteContinuationHints(segmentation: PaperNotePageSegmentation): PaperNotePageSegmentation {
  const output: PaperNotePageSegmentation["entries"] = [];
  for (const original of segmentation.entries) {
    const current = { ...original };
    const previous = output.at(-1);
    if (!previous?.region || !current.region) {
      output.push(current);
      continue;
    }
    const verticalGap = current.region.y - (previous.region.y + previous.region.height);
    const sameColumn = horizontalOverlap(previous.region, current.region) >= 0.58;
    const closeVertically = verticalGap >= -0.025 && verticalGap <= 0.075;
    const continuationSignal = previous.mayContinue || likelyContinuationText(current.roughText);
    if (sameColumn && closeVertically && continuationSignal) {
      previous.roughText = [previous.roughText.trim(), current.roughText.trim()].filter(Boolean).join("\n");
      previous.region = mergedRegion(previous.region, current.region);
      previous.mayContinue = current.mayContinue;
      continue;
    }
    output.push(current);
  }
  return {
    ...segmentation,
    entries: output.map((entry, sourceOrder) => ({ ...entry, sourceOrder })),
  };
}

function phoneValues(extraction: PaperNoteExtraction) {
  return [
    ...extraction.organizationPhones,
    ...extraction.contacts.flatMap((contact) => contact.phones),
  ].map((phone) => phone.number?.trim() ?? "").filter(Boolean);
}

export function shouldVerifyCriticalPaperNoteDetails(extraction: PaperNoteExtraction) {
  return !extraction.event.name?.trim()
    || extraction.contacts.some((contact) => !contact.name?.trim())
    || phoneValues(extraction).length > 0;
}

function normalizedDigits(value: string | null | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

function disagreementWarning(path: string, first: string, second: string): PaperNoteWarning {
  return {
    fieldPath: path,
    message: `Two AI reads disagree on this handwritten number (${first} vs ${second}). Check the original paper before importing.`,
    severity: "blocking",
  };
}

export function mergeCriticalPaperNoteRead(first: PaperNoteExtraction, second: PaperNoteExtraction): PaperNoteExtraction {
  const warnings = [...first.warnings];
  const contacts = first.contacts.map((contact, contactIndex) => {
    const verification = second.contacts[contactIndex];
    return {
      ...contact,
      name: contact.name?.trim() ? contact.name : verification?.name ?? null,
      role: contact.role?.trim() ? contact.role : verification?.role ?? null,
      email: contact.email?.trim() ? contact.email : verification?.email ?? null,
      phones: contact.phones.map((phone, phoneIndex) => {
        const verified = verification?.phones[phoneIndex];
        if (phone.number && verified?.number) {
          const firstDigits = normalizedDigits(phone.number);
          const secondDigits = normalizedDigits(verified.number);
          if (firstDigits && secondDigits && firstDigits !== secondDigits) {
            warnings.push(disagreementWarning(`contacts.${contactIndex}.phones.${phoneIndex}.number`, phone.number, verified.number));
          }
        }
        return {
          ...phone,
          number: phone.number ?? verified?.number ?? null,
          extension: phone.extension ?? verified?.extension ?? null,
          label: phone.label ?? verified?.label ?? null,
          instructions: phone.instructions ?? verified?.instructions ?? null,
          type: phone.type === "unknown" ? verified?.type ?? phone.type : phone.type,
        };
      }),
    };
  });

  const organizationPhones = first.organizationPhones.map((phone, phoneIndex) => {
    const verified = second.organizationPhones[phoneIndex];
    if (phone.number && verified?.number) {
      const firstDigits = normalizedDigits(phone.number);
      const secondDigits = normalizedDigits(verified.number);
      if (firstDigits && secondDigits && firstDigits !== secondDigits) {
        warnings.push(disagreementWarning(`organizationPhones.${phoneIndex}.number`, phone.number, verified.number));
      }
    }
    return {
      ...phone,
      number: phone.number ?? verified?.number ?? null,
      extension: phone.extension ?? verified?.extension ?? null,
      label: phone.label ?? verified?.label ?? null,
      instructions: phone.instructions ?? verified?.instructions ?? null,
      type: phone.type === "unknown" ? verified?.type ?? phone.type : phone.type,
    };
  });

  const event = {
    name: first.event.name?.trim() ? first.event.name : second.event.name,
    city: first.event.city?.trim() ? first.event.city : second.event.city,
    region: first.event.region?.trim() ? first.event.region : second.event.region,
    venue: first.event.venue?.trim() ? first.event.venue : second.event.venue,
  };
  const filteredWarnings = event.name?.trim()
    ? warnings.filter((warning) => !(warning.fieldPath === "event.name" && /no event or organization name/i.test(warning.message)))
    : warnings;

  return { ...first, event, contacts, organizationPhones, warnings: filteredWarnings };
}
