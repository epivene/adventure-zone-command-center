import type {
  GoogleGmailLabelMutationClient,
  GoogleLabelSummary,
} from "./google-api-types";
import {
  canonicalProfileLabelName,
  isProfileLabelPath,
  normalizedProfileLabelPath,
} from "./google-profile-label-config";
import type {
  GoogleProfileLabelMapping,
  GoogleProfileLabelRepositoryPort,
} from "./google-profile-label-repository";

export type GoogleProfileLabelResolution =
  | { status: "resolved"; mapping: GoogleProfileLabelMapping }
  | {
      status: "conflict";
      code: "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT";
      labels: GoogleLabelSummary[];
    };

function errorCode(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "string"
  ) return (error as { code: string }).code;
  return error instanceof Error ? error.message : "GOOGLE_WORKSPACE_PROFILE_LABEL_FAILED";
}

export class GoogleProfileLabelResolver {
  constructor(
    private readonly repository: GoogleProfileLabelRepositoryPort,
    private readonly gmail: GoogleGmailLabelMutationClient,
  ) {}

  private async conflict(
    input: { connectionId: string; organizationId: string },
    labels: GoogleLabelSummary[],
  ): Promise<GoogleProfileLabelResolution> {
    await this.repository.markState({
      ...input,
      state: "conflict",
      errorCode: "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT",
    });
    return {
      status: "conflict",
      code: "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT",
      labels,
    };
  }

  async resolve(input: {
    connectionId: string;
    organizationId: string;
  }): Promise<GoogleProfileLabelResolution> {
    const organization = await this.repository.getOrganization(input);
    if (!organization || organization.consolidatedIntoId) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");
    }

    const labels = await this.gmail.listLabels();
    const saved = await this.repository.findByOrganization(input);
    if (saved) {
      const existing = labels.find((label) => label.id === saved.gmailLabelId);
      if (!existing) {
        await this.repository.markState({
          ...input,
          state: "unavailable",
          errorCode: "GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND",
        });
        throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND");
      }
      const owner = await this.repository.findByLabelId({
        connectionId: input.connectionId,
        gmailLabelId: existing.id,
      });
      if (owner && owner.organizationId !== input.organizationId) {
        return this.conflict(input, [existing]);
      }
      return {
        status: "resolved",
        mapping: {
          ...saved,
          gmailLabelName: existing.name,
          state: "active",
          lastErrorCode: null,
        },
      };
    }

    const canonicalName = canonicalProfileLabelName(organization.name);
    const exact = labels.filter(
      (label) => label.type === "user" && label.name === canonicalName,
    );
    const normalizedName = normalizedProfileLabelPath(canonicalName);
    const compatible = labels.filter(
      (label) =>
        label.type === "user" &&
        isProfileLabelPath(label.name) &&
        normalizedProfileLabelPath(label.name) === normalizedName,
    );
    const candidates = exact.length ? exact : compatible;
    if (candidates.length > 1) return this.conflict(input, candidates);

    if (candidates.length === 1) {
      const candidate = candidates[0]!;
      const owner = await this.repository.findByLabelId({
        connectionId: input.connectionId,
        gmailLabelId: candidate.id,
      });
      if (owner && owner.organizationId !== input.organizationId) {
        return this.conflict(input, [candidate]);
      }
      try {
        return {
          status: "resolved",
          mapping: await this.repository.adopt({
            ...input,
            gmailLabelId: candidate.id,
            gmailLabelName: candidate.name,
          }),
        };
      } catch (error) {
        if (errorCode(error) === "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT") {
          return this.conflict(input, [candidate]);
        }
        throw error;
      }
    }

    const created = await this.gmail.createLabel(canonicalName);
    try {
      return {
        status: "resolved",
        mapping: await this.repository.adopt({
          ...input,
          gmailLabelId: created.id,
          gmailLabelName: created.name,
        }),
      };
    } catch (error) {
      const winner = await this.repository.findByOrganization(input);
      if (winner) {
        return winner.gmailLabelId === created.id
          ? { status: "resolved", mapping: winner }
          : this.conflict(input, [created]);
      }
      throw error;
    }
  }

  async reconcileDisplayName(input: {
    connectionId: string;
    organizationId: string;
  }): Promise<GoogleProfileLabelResolution> {
    const resolved = await this.resolve(input);
    if (resolved.status === "conflict") return resolved;
    const organization = await this.repository.getOrganization(input);
    if (!organization || organization.consolidatedIntoId) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");
    }
    const canonicalName = canonicalProfileLabelName(organization.name);
    if (resolved.mapping.gmailLabelName === canonicalName) return resolved;
    const labels = await this.gmail.listLabels();
    const collision = labels.filter(
      (label) =>
        label.id !== resolved.mapping.gmailLabelId &&
        normalizedProfileLabelPath(label.name) ===
          normalizedProfileLabelPath(canonicalName),
    );
    if (collision.length) return this.conflict(input, collision);
    const renamed = await this.gmail.renameLabel({
      labelId: resolved.mapping.gmailLabelId,
      name: canonicalName,
    });
    return {
      status: "resolved",
      mapping: await this.repository.adopt({
        ...input,
        gmailLabelId: renamed.id,
        gmailLabelName: renamed.name,
      }),
    };
  }
}
