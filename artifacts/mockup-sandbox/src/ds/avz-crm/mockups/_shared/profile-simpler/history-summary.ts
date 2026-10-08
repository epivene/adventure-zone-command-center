export type ProfileHistoryItem = {
  kind?: string | null;
  body?: string | null;
  importedFromAct?: boolean;
  actSourceType?: string | null;
};

function cleanQuoted(value: string) {
  return value.trim().replace(/^"|"$/g, "").trim();
}

function friendlyStage(value: string) {
  const cleaned = cleanQuoted(value);
  const lastPart = cleaned.split("/").filter(Boolean).at(-1) ?? cleaned;
  return lastPart.replaceAll("_", " ");
}

function decodeHtmlEntities(value: string) {
  const named: Record<string, string> = { amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"' };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized.startsWith("#x")) {
      const code = Number.parseInt(normalized.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (normalized.startsWith("#")) {
      const code = Number.parseInt(normalized.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[normalized] ?? match;
  });
}

export function htmlToPlainText(value: string) {
  if (!value) return "";
  const withoutHiddenBlocks = value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  const withBreaks = withoutHiddenBlocks
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(?:div|p|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<li\b[^>]*>/gi, "• ");
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isSystemHistoryText(value: string) {
  const text = htmlToPlainText(value).trim();
  if (!text) return true;
  return /^Field\s+.+?\s+changed\s+from\s+.+?\s+to\s+.+$/i.test(text)
    || /^A new opportunity called\s+.+?\s+was created/i.test(text)
    || /^Opportunity\s+.+?\s+(?:created|deleted|updated)/i.test(text)
    || /^Record\s+.+?\s+(?:created|deleted|updated)/i.test(text)
    || /^(?:linked|unlinked)(?:\s+|$)/i.test(text)
    || /^(?:updated|created|deleted|linked|unlinked)\.?$/i.test(text)
    || /^(?:contact|company|organization|opportunity|activity|booking|event|record)\b.{0,120}\b(?:linked|unlinked|updated|created|deleted)\.?$/i.test(text);
}

export function simplifyHistoryText(body: string) {
  const text = htmlToPlainText(body).trim();
  if (!text) return "Profile updated";

  let match = text.match(/^Field\s+Stage\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `Stage changed to ${friendlyStage(match[2] ?? "")}`;

  match = text.match(/^Field\s+Probability of Close\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `Booking likelihood changed from ${cleanQuoted(match[1] ?? "")}% to ${cleanQuoted(match[2] ?? "")}%`;

  match = text.match(/^Field\s+Opportunity Name\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `Renamed opportunity to ${cleanQuoted(match[2] ?? "")}`;

  match = text.match(/^Field\s+Estimated Close Date\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `Estimated close date changed to ${cleanQuoted(match[2] ?? "")}`;

  match = text.match(/^A new opportunity called\s+(.+?)\s+was created/i);
  if (match) {
    const name = cleanQuoted(match[1] ?? "");
    return !name || /^new opportunity$/i.test(name) ? "New opportunity created" : `New opportunity created: ${name}`;
  }

  match = text.match(/^Field\s+(.+?)\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `${match[1]} changed to ${cleanQuoted(match[3] ?? "")}`;

  return text;
}

export type HistoryFilter = "all" | "calls" | "notes" | "follow-ups" | "act" | "system";

export function historyCategory(item: ProfileHistoryItem): Exclude<HistoryFilter, "all"> {
  const kind = (item.kind ?? "").toLowerCase();
  const actSourceType = (item.actSourceType ?? "").toLowerCase();
  const plainBody = htmlToPlainText(item.body ?? "");
  const systemLike = isSystemHistoryText(plainBody);

  if (actSourceType === "note") return systemLike && !plainBody.trim() ? "system" : "notes";
  if (actSourceType === "history") return systemLike ? "system" : "notes";
  if (actSourceType === "activity") return kind.includes("call") ? "calls" : (systemLike ? "system" : "act");

  if (kind.includes("call")) return "calls";
  if (kind.includes("follow")) return "follow-ups";
  if (kind.includes("note")) return systemLike && !plainBody.trim() ? "system" : "notes";
  if (systemLike || kind.includes("audit")) return "system";
  if (kind.includes("history") && item.importedFromAct) return "notes";
  if (kind.includes("history")) return "system";
  if (item.importedFromAct) return "act";
  return "notes";
}
