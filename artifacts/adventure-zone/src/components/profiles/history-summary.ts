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

export function simplifyHistoryText(body: string) {
  const text = body.trim();
  if (!text) return "Profile updated";

  let match = text.match(/^Field\s+Stage\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `Stage changed to ${friendlyStage(match[2] ?? "")}`;

  match = text.match(/^Field\s+Probability of Close\s+changed\s+from\s+(.+?)\s+to\s+(.+)$/i);
  if (match) return `Booking likelihood changed from ${cleanQuoted(match[1] ?? "")}\% to ${cleanQuoted(match[2] ?? "")}\%`;

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
  if (item.importedFromAct || item.actSourceType) return "act";
  const kind = (item.kind ?? "").toLowerCase();
  if (kind.includes("call")) return "calls";
  if (kind.includes("follow")) return "follow-ups";
  if (kind.includes("note")) return "notes";
  if (kind.includes("history") || kind.includes("audit") || /^Field\s+/i.test(item.body ?? "")) return "system";
  return "notes";
}
