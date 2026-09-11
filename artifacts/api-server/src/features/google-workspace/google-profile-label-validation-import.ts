import { PostgresGoogleConnectionRepository } from "./google-connection-repository";
import type { GoogleMessageRef, GoogleWorkspaceReadClient } from "./google-api-types";
import { normalizedProfileLabelPath, profileLabelIdentity } from "./google-profile-label-config";
import {
  PostgresGoogleProfileLabelRepository,
  type GoogleProfileLabelRepositoryPort,
} from "./google-profile-label-repository";
import {
  PostgresGoogleValidationRepository,
  type GoogleApprovedValidationMapping,
} from "./google-validation-repository";

type ConnectionAccess = {
  getCurrent(): Promise<{ id: string } | null>;
  createReadClient(): Promise<GoogleWorkspaceReadClient | null>;
};

type ValidationAccess = {
  listApprovedForOrganization(
    organizationId: string,
  ): Promise<GoogleApprovedValidationMapping[]>;
  upsertRows(rows: GoogleApprovedValidationMapping[]): Promise<void>;
};

const excludedProfileTokens = new Set(["rmfa", "rmaf", "spacs", "spacks"]);

export function profileLabelImportIsExcluded(profileName: string): boolean {
  const tokens = normalizedProfileLabelPath(profileName)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return tokens.some((token) => excludedProfileTokens.has(token));
}

export class GoogleProfileLabelValidationImportService {
  private readonly connections: ConnectionAccess;
  private readonly labels: GoogleProfileLabelRepositoryPort;
  private readonly validation: ValidationAccess;

  constructor(dependencies?: {
    connections?: ConnectionAccess;
    labels?: GoogleProfileLabelRepositoryPort;
    validation?: ValidationAccess;
  }) {
    this.connections =
      dependencies?.connections ?? new PostgresGoogleConnectionRepository();
    this.labels =
      dependencies?.labels ?? new PostgresGoogleProfileLabelRepository();
    this.validation =
      dependencies?.validation ?? new PostgresGoogleValidationRepository();
  }

  async reconcileOrganization(
    organizationId: string,
  ): Promise<GoogleApprovedValidationMapping[]> {
    const existing =
      await this.validation.listApprovedForOrganization(organizationId);

    const current = await this.connections.getCurrent();
    if (!current) return existing;

    const organization = await this.labels.getOrganization({
      connectionId: current.id,
      organizationId,
    });
    if (
      !organization ||
      organization.consolidatedIntoId ||
      profileLabelImportIsExcluded(organization.name)
    ) {
      return existing;
    }

    const client = await this.connections.createReadClient();
    if (!client?.listMessagePage) return existing;

    const gmailLabels = await client.listLabels();
    const saved = await this.labels.findByOrganization({
      connectionId: current.id,
      organizationId,
    });
    let selected =
      saved?.state === "active"
        ? gmailLabels.find((label) => label.id === saved.gmailLabelId)
        : undefined;

    if (!selected) {
      const identity = normalizedProfileLabelPath(organization.name);
      const candidates = gmailLabels.filter(
        (label) =>
          label.type === "user" &&
          profileLabelIdentity(label.name) === identity,
      );
      if (candidates.length !== 1) return existing;
      selected = candidates[0]!;
      if (saved) {
        await this.labels.markState({
          connectionId: current.id,
          organizationId,
          state: "unavailable",
          errorCode: "GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND",
        });
      }
      await this.labels.adopt({
        connectionId: current.id,
        organizationId,
        gmailLabelId: selected.id,
        gmailLabelName: selected.name,
      });
    }

    const selectedLabels = [selected];
    if (existing.length && client.getMessageMetadata) {
      try {
        const metadata = await client.getMessageMetadata(existing[0]!.messageId);
        const supportedLabels = gmailLabels.filter(
          (label) =>
            label.type === "user" &&
            metadata.labelIds.includes(label.id) &&
            profileLabelIdentity(label.name) !== null,
        );
        if (
          supportedLabels.length === 1 &&
          supportedLabels[0]!.id !== selected.id
        ) {
          const owner = await this.labels.findByLabelId({
            connectionId: current.id,
            gmailLabelId: supportedLabels[0]!.id,
          });
          if (!owner || owner.organizationId === organizationId) {
            selectedLabels.push(supportedLabels[0]!);
          }
        }
      } catch {
        // A deleted historical message must not block the saved label import.
      }
    }

    const refs: GoogleMessageRef[] = [];
    const seenMessages = new Set<string>();
    for (const label of selectedLabels) {
      let pageToken: string | null = null;
      let pageCount = 0;
      do {
        const page = await client.listMessagePage({
          maxResults: 250,
          pageToken,
          labelIds: [label.id],
        });
        for (const ref of page.messages) {
          if (!seenMessages.has(ref.id)) {
            refs.push(ref);
            seenMessages.add(ref.id);
          }
        }
        pageToken = page.nextPageToken;
        pageCount += 1;
        if (pageCount > 10_000) {
          throw new Error("GOOGLE_WORKSPACE_PROFILE_LABEL_IMPORT_PAGE_LIMIT");
        }
      } while (pageToken);
    }

    if (refs.length) {
      await this.validation.upsertRows(
        refs.map((ref) => ({
          messageId: ref.id,
          threadId: ref.threadId,
          organizationId,
          contactId: null,
          evidenceCodes: ["gmail_profile_label"],
        })),
      );
    }
    return this.validation.listApprovedForOrganization(organizationId);
  }
}
