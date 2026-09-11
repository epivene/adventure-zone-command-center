import { pool as defaultPool } from "@workspace/db";

import type { GoogleLabelSummary } from "./google-api-types";
import {
  PostgresGoogleConnectionRepository,
  type GoogleConnectionSqlPool,
} from "./google-connection-repository";
import {
  canonicalProfileLabelName,
  isProfileLabelPath,
  profileLabelIdentity,
} from "./google-profile-label-config";

export type GoogleProfileLabelCleanupCandidate = {
  id: string;
  name: string;
};

export type GoogleProfileLabelCleanupFailure =
  GoogleProfileLabelCleanupCandidate & { errorCode: string };

export type GoogleProfileLabelNameSource = {
  listCurrentProfileNames(): Promise<string[]>;
  prepareLabelDeletion?(labelId: string): Promise<void>;
};

export type GoogleProfileLabelCleanupGmailClient = {
  listLabels(): Promise<GoogleLabelSummary[]>;
  deleteLabel(labelId: string): Promise<void>;
};

function cleanupErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) {
    return (error as { code: string }).code;
  }
  return error instanceof Error
    ? error.message
    : "GOOGLE_WORKSPACE_PROFILE_LABEL_CLEANUP_FAILED";
}

function candidates(
  labels: GoogleLabelSummary[],
  currentProfileNames: string[],
): GoogleProfileLabelCleanupCandidate[] {
  // Converting every current name here is deliberately fail-closed. If even
  // one current CRM profile cannot be represented by the canonical label
  // policy, cleanup must not offer any labels for deletion.
  const current = new Set(
    currentProfileNames.map((name) =>
      profileLabelIdentity(canonicalProfileLabelName(name)),
    ),
  );
  return labels
    .filter(
      (label) =>
        label.type === "user" &&
        isProfileLabelPath(label.name) &&
        !current.has(profileLabelIdentity(label.name)),
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
    const [currentProfileNames, labels] = await Promise.all([
      this.profiles.listCurrentProfileNames(),
      this.gmail.listLabels(),
    ]);
    return { labels: candidates(labels, currentProfileNames) };
  }

  async deleteSelected(labelIds: string[]): Promise<{
    deleted: GoogleProfileLabelCleanupCandidate[];
    skippedLabelIds: string[];
    failed: GoogleProfileLabelCleanupFailure[];
  }> {
    const selected = [
      ...new Set(labelIds.map((id) => id.trim()).filter(Boolean)),
    ];
    const safeById = new Map(
      (await this.preview()).labels.map((label) => [label.id, label]),
    );
    const deleted: GoogleProfileLabelCleanupCandidate[] = [];
    const skippedLabelIds: string[] = [];
    const failed: GoogleProfileLabelCleanupFailure[] = [];

    for (const labelId of selected) {
      const label = safeById.get(labelId);
      if (!label) {
        skippedLabelIds.push(labelId);
        continue;
      }
      try {
        // Invalidate any saved mapping before the destructive Gmail call. If
        // this database step fails, Gmail is left untouched. If Gmail fails,
        // the existing label can be re-adopted by the normal resolver.
        await this.profiles.prepareLabelDeletion?.(labelId);
        await this.gmail.deleteLabel(labelId);
        deleted.push(label);
      } catch (error) {
        failed.push({ ...label, errorCode: cleanupErrorCode(error) });
      }
    }

    return { deleted, skippedLabelIds, failed };
  }
}

class PostgresGoogleProfileLabelNameSource
implements GoogleProfileLabelNameSource {
  constructor(
    private readonly connectionId: string,
    private readonly pool: GoogleConnectionSqlPool,
  ) {}

  async listCurrentProfileNames(): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT name
         FROM organizations
        WHERE consolidated_into_id IS NULL
        ORDER BY name, id`,
    );
    return result.rows.map((row) => {
      if (typeof row.name !== "string") {
        throw new Error(
          "GOOGLE_WORKSPACE_PROFILE_LABEL_CLEANUP_PROFILE_INVALID",
        );
      }
      return row.name;
    });
  }

  async prepareLabelDeletion(labelId: string): Promise<void> {
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
