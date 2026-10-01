import { attentionLabelHandler } from "./email-thread-attention-sync";
import { pool as defaultPool } from "@workspace/db";

import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import { PostgresGoogleGmailMutationRepository } from "./google-gmail-mutation-repository";
import { readGoogleProfileLabelConfig } from "./google-profile-label-config";
import { PostgresGoogleProfileLabelRepository } from "./google-profile-label-repository";
import { GoogleProfileLabelResolver } from "./google-profile-label-resolver";
import {
  GoogleProfileLabelSyncService,
  type GoogleProfileLabelSyncServicePort,
} from "./google-profile-label-sync-service";

export type GoogleInboundProfileLabelCandidate = {
  id: string;
  threadId: string;
  labelIds: string[];
  evidenceCodes: string[];
  resolvedOrganization: { id: string; name: string } | null;
};

type SqlPool = {
  query(text: string, values?: unknown[]): Promise<{
    rows: Array<Record<string, unknown>>;
  }>;
};

type SyncFactory = () => Promise<{
  connectionId: string;
  service: GoogleProfileLabelSyncServicePort;
  ensureHierarchy(): Promise<void>;
}>;

export class GoogleInboundProfileLabeler {
  private readonly syncFactory: SyncFactory;
  private readonly dueMutationIds: () => Promise<string[]>;

  constructor(options: {
    syncFactory?: SyncFactory;
    dueMutationIds?: () => Promise<string[]>;
    pool?: SqlPool;
  } = {}) {
    const pool = options.pool ?? (defaultPool as unknown as SqlPool);
    const mutations = new PostgresGoogleGmailMutationRepository(pool);
    this.dueMutationIds = options.dueMutationIds ??
      (options.syncFactory
        ? async () => []
        : () => mutations.listDueIdsForCurrentConnection(new Date()));
    this.syncFactory = options.syncFactory ?? (async () => {
      const connection = await new PostgresGoogleConnectionRepository({
        pool: pool as never,
      }).createGmailLabelMutationClient();
      if (!connection) throw new Error("GOOGLE_WORKSPACE_NOT_CONNECTED");
      const labels = new PostgresGoogleProfileLabelRepository(pool);
      const resolver = new GoogleProfileLabelResolver(labels, connection.client);
      const enabled = readGoogleProfileLabelConfig().enabled;
      return {
        connectionId: connection.connectionId,
        ensureHierarchy: async () => {
          if (enabled) await resolver.ensureHierarchy();
        },
        service: new GoogleProfileLabelSyncService({
          enabled,
          mutations,
          resolver,
          labels,
          gmail: connection.client,
          attention: attentionLabelHandler(pool as never, connection.client),
        }),
      };
    });
  }

  async labelNewThreadMatches(
    messages: GoogleInboundProfileLabelCandidate[],
  ): Promise<void> {
    const candidates = messages.filter((message) =>
      message.resolvedOrganization &&
      message.evidenceCodes.includes("existing_thread_association") &&
      !message.labelIds.includes("SENT") && !message.labelIds.includes("DRAFT")
    );
    const dueMutationIds = await this.dueMutationIds();
    const sync = await this.syncFactory();
    await sync.ensureHierarchy();
    if (!candidates.length && !dueMutationIds.length) return;
    for (const mutationId of dueMutationIds) {
      await sync.service.retry(mutationId);
    }
    for (const message of candidates) {
      await sync.service.labelInboundMessage({
        connectionId: sync.connectionId,
        messageId: message.id,
        threadId: message.threadId,
        organizationId: message.resolvedOrganization!.id,
      });
    }
  }
}
