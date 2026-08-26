export type ActProfileTextEvidence = {
  sourceRecordId: string;
  sourceVersionId: string;
  sourcePath: string;
  kind: "description" | "business_card";
  originalText: string;
  emails: string[];
};

type ActProfileTextEvidenceSource = {
  sourceRecordId: string;
  sourceVersionId: string;
};

const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;

function evidenceKind(propertyName: string): ActProfileTextEvidence["kind"] | null {
  const normalized = propertyName.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (normalized === "businesscard" || normalized.endsWith("businesscard")) {
    return "business_card";
  }
  if (normalized === "description" || normalized.endsWith("description")) {
    return "description";
  }
  return null;
}

function propertyPath(parentPath: string, propertyName: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(propertyName)
    ? `${parentPath}.${propertyName}`
    : `${parentPath}[${JSON.stringify(propertyName)}]`;
}

function uniqueEmails(value: string): string[] {
  const matches = value.match(emailPattern) ?? [];
  return [...new Set(matches.map((email) => email.toLowerCase()))];
}

export function extractActProfileTextEvidence(
  rawSnapshot: unknown,
  source: ActProfileTextEvidenceSource,
): ActProfileTextEvidence[] {
  if (rawSnapshot === null || typeof rawSnapshot !== "object") return [];

  const evidence: ActProfileTextEvidence[] = [];
  const visited = new WeakSet<object>();

  function visit(value: unknown, path: string): void {
    if (value === null || typeof value !== "object") return;
    if (visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${path}[${index}]`));
      return;
    }

    for (const [propertyName, propertyValue] of Object.entries(value)) {
      const nextPath = propertyPath(path, propertyName);
      if (typeof propertyValue === "string") {
        const kind = evidenceKind(propertyName);
        if (!kind || !propertyValue.trim()) continue;
        evidence.push({
          ...source,
          sourcePath: nextPath,
          kind,
          originalText: propertyValue,
          emails: uniqueEmails(propertyValue),
        });
        continue;
      }
      visit(propertyValue, nextPath);
    }
  }

  visit(rawSnapshot, "$");
  return evidence;
}
