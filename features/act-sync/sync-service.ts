import { ActClient } from "@/features/act-sync/act-client";
import { ActApiError } from "@/features/act-sync/act-errors";
import type { RemoteActContact } from "@/features/act-sync/act-types";
import {
  DrizzleSyncRepository,
  type SyncRepository,
  type SyncSummary,
} from "@/features/act-sync/sync-repository";
import {
  compareContactSets,
  syncComparisonCategories,
  type SyncComparisonRow,
} from "@/features/act-sync/sync-comparison";
import { getActEnvironment } from "@/lib/env";

export interface ActSyncClient {
  listContacts(): Promise<RemoteActContact[]>;
}

function summarize(rows: readonly SyncComparisonRow[]): SyncSummary {
  const summary = Object.fromEntries(
    syncComparisonCategories.map((category) => [category, 0]),
  ) as SyncSummary;
  for (const row of rows) summary[row.category] += 1;
  return summary;
}

export class ActSyncService {
  constructor(
    private readonly client: ActSyncClient,
    private readonly repository: SyncRepository,
  ) {}

  async createPreview() {
    const [localContacts, remoteContacts] = await Promise.all([
      this.repository.listLocalContacts(),
      this.client.listContacts(),
    ]);
    const rows = compareContactSets(localContacts, remoteContacts);
    return this.repository.createPreview(rows, summarize(rows));
  }

  getPreview(runId: string) {
    return this.repository.getPreview(runId);
  }
}

export async function createDefaultActSyncService() {
  const environment = getActEnvironment();
  if (!environment.configured) {
    throw new ActApiError("not_configured", false);
  }
  const { db } = await import("@/db/client");
  return new ActSyncService(
    new ActClient(environment.config),
    new DrizzleSyncRepository(db),
  );
}
