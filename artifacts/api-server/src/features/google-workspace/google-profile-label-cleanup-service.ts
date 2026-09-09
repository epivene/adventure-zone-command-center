import type { GoogleLabelSummary } from "./google-api-types";
import {
  isProfileLabelPath,
  normalizedProfileLabelPath,
} from "./google-profile-label-config";

export type GoogleProfileLabelCleanupCandidate = {
  id: string;
  name: string;
};

export type GoogleProfileLabelNameSource = {
  listCanonicalLabelNames(): Promise<string[]>;
  labelDeleted?(labelId: string): Promise<void>;
};

export type GoogleProfileLabelCleanupGmailClient = {
  listLabels(): Promise<GoogleLabelSummary[]>;
  deleteLabel(labelId: string): Promise<void>;
};

function candidates(
  labels: GoogleLabelSummary[],
  canonicalNames: string[],
): GoogleProfileLabelCleanupCandidate[] {
  const current = new Set(
    canonicalNames.map((name) => normalizedProfileLabelPath(name)),
  );
  return labels
    .filter(
      (label) =>
        label.type === "user" &&
        isProfileLabelPath(label.name) &&
        !current.has(normalizedProfileLabelPath(label.name)),
    )
    .map(({ id, name }) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export class GoogleProfileLabelCleanupService {
  constructor(
    private readonly profiles: GoogleProfileLabelNameSource,
    private readonly gmail: GoogleProfileLabelCleanupGmailClient,
  ) {}

  async preview(): Promise<{ labels: GoogleProfileLabelCleanupCandidate[] }> {
    const [canonicalNames, labels] = await Promise.all([
      this.profiles.listCanonicalLabelNames(),
      this.gmail.listLabels(),
    ]);
    return { labels: candidates(labels, canonicalNames) };
  }

  async deleteSelected(labelIds: string[]): Promise<{
    deleted: GoogleProfileLabelCleanupCandidate[];
    skippedLabelIds: string[];
  }> {
    const selected = [
      ...new Set(labelIds.map((id) => id.trim()).filter(Boolean)),
    ];
    const safeById = new Map(
      (await this.preview()).labels.map((label) => [label.id, label]),
    );
    const deleted: GoogleProfileLabelCleanupCandidate[] = [];
    const skippedLabelIds: string[] = [];

    for (const labelId of selected) {
      const label = safeById.get(labelId);
      if (!label) {
        skippedLabelIds.push(labelId);
        continue;
      }
      await this.gmail.deleteLabel(labelId);
      await this.profiles.labelDeleted?.(labelId);
      deleted.push(label);
    }

    return { deleted, skippedLabelIds };
  }
}
