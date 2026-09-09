import { pool as defaultPool } from "@workspace/db";

import type { GoogleLabelSummary } from "./google-api-types";
import {
  PostgresGoogleConnectionRepository,
  type GoogleConnectionSqlPool,
} from "./google-connection-repository";
import {
  canonicalProfileLabelName,
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


class PostgresGoogleProfileLabelNameSource
implements GoogleProfileLabelNameSource {
  constructor(
    private readonly connectionId: string,
    private readonly pool: GoogleConnectionSqlPool,
  ) {}

  async listCanonicalLabelNames(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT name
         FROM organizations
        WHERE consolidated_into_id IS NULL
        ORDER BY name, id`,
    );
    return result.rows.flatMap((row) => {
      if (typeof row.name !== "string") return [];
      try {
        return [canonicalProfileLabelName(row.name)];
      } catch {
        return [];
      }
    });
  }

  async labelDeleted(labelId: string): Promise<void> {
    await this.pool.query(
      `UPDATE google_workspace_profile_labels
          SET state = 'unavailable',
              last_error_code = 'GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND',
              updated_at = now()
        WHERE connection_id = $1
          AND gmail_label_id = $2`,
      [this.connectionId, labelId],
    );
  }
}

export class PostgresGoogleProfileLabelCleanupService {
  constructor(
    private readonly pool: GoogleConnectionSqlPool =
      defaultPool as unknown as GoogleConnectionSqlPool,
  ) {}

  private async service(): Promise<GoogleProfileLabelCleanupService> {
    const connection = await new PostgresGoogleConnectionRepository({
      pool: this.pool,
    }).createGmailLabelMutationClient();
    if (!connection) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
    if (!connection.client.deleteLabel) {
      throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_CLIENT_UNAVAILABLE");
    }
    return new GoogleProfileLabelCleanupService(
      new PostgresGoogleProfileLabelNameSource(
        connection.connectionId,
        this.pool,
      ),
      {
        listLabels: connection.client.listLabels,
        deleteLabel: connection.client.deleteLabel,
      },
    );
  }

  async preview() {
    return (await this.service()).preview();
  }

  async deleteSelected(labelIds: string[]) {
    return (await this.service()).deleteSelected(labelIds);
  }
}
