import type {
  GoogleGmailLabelMutationClient,
  GoogleLabelSummary,
} from "./google-api-types";
import {
  canonicalProfileLabelName,
  GOOGLE_PROFILE_LABEL_HIERARCHY,
  GOOGLE_PROFILE_LABEL_ROOT,
  isCurrentProfileLabelPath,
  normalizedProfileLabelPath,
  profileLabelIdentity,
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
    private readonly mode: "shared" | "individual" = "shared",
  ) {}

  async ensureHierarchy(
    knownLabels?: GoogleLabelSummary[],
  ): Promise<GoogleLabelSummary[]> {
    let labels = knownLabels ? [...knownLabels] : await this.gmail.listLabels();

    for (const name of GOOGLE_PROFILE_LABEL_HIERARCHY) {
      const normalizedName = normalizedProfileLabelPath(name);
      const existing = labels.find(
        (label) =>
          label.type === "user" &&
          normalizedProfileLabelPath(label.name) === normalizedName,
      );
      if (existing) continue;

      try {
        const created = await this.gmail.createLabel!(name);
        labels.push(created);
      } catch (error) {
        if (errorCode(error) !== "GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT") {
          throw error;
        }
        labels = await this.gmail.listLabels();
        const winner = labels.find(
          (label) =>
            label.type === "user" &&
            normalizedProfileLabelPath(label.name) === normalizedName,
        );
        if (!winner) {
          throw new Error("GOOGLE_WORKSPACE_GMAIL_RETRYABLE_FAILURE");
        }
      }
    }

    return labels;
  }

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
    reuseOnly?: boolean;
  }): Promise<GoogleProfileLabelResolution> {
    const organization = await this.repository.getOrganization(input);
    if (!organization || organization.consolidatedIntoId) {
      throw new Error("GOOGLE_WORKSPACE_REVIEW_TARGET_NOT_FOUND");
    }

    if (this.mode === "shared") {
      const labels = await this.ensureHierarchy();
      const category = labels.find(label => label.type === "user" &&
        normalizedProfileLabelPath(label.name) === normalizedProfileLabelPath(GOOGLE_PROFILE_LABEL_ROOT));
      if (!category) throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND");
      // A shared category is not a customer identity. Keep historical mappings
      // intact; the committed message/thread association owns the CRM identity.
      return { status: "resolved", mapping: {
        connectionId: input.connectionId, organizationId: input.organizationId,
        gmailLabelId: category.id, gmailLabelName: GOOGLE_PROFILE_LABEL_ROOT,
        state: "active", lastErrorCode: null,
      } };
    }

    if (input.reuseOnly) {
      const saved = await this.repository.findByOrganization(input);
      if (!saved) throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND");
      const labels = await this.gmail.listLabels();
      const label = labels.find((item) => item.id === saved.gmailLabelId);
      if (!label || label.type !== "user" || !profileLabelIdentity(label.name)) throw new Error("GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND");
      const owner = await this.repository.findByLabelId({connectionId:input.connectionId,gmailLabelId:label.id});
      if (saved.state === "conflict" || (owner && owner.organizationId !== input.organizationId)) return this.conflict(input,[label]);
      return {status:"resolved",mapping:saved};
    }
    const labels = await this.ensureHierarchy(await this.gmail.listLabels());
    const saved = await this.repository.findByOrganization(input);
    if (saved) {
      const existing = labels.find((label) => label.id === saved.gmailLabelId);
      if (existing && isCurrentProfileLabelPath(existing.name)) {
        const owner = await this.repository.findByLabelId({
          connectionId: input.connectionId,
          gmailLabelId: existing.id,
        });
        if (owner && owner.organizationId !== input.organizationId) {
          return this.conflict(input, [existing]);
        }
        return {
          status: "resolved",
          mapping: saved.gmailLabelName !== existing.name || saved.state !== "active" || saved.lastErrorCode
            ? await this.repository.adopt({
              ...input,
              gmailLabelId: existing.id,
              gmailLabelName: existing.name,
            })
            : saved,
        };
      }
      await this.repository.markState({
        ...input,
        state: "unavailable",
        errorCode: "GOOGLE_WORKSPACE_GMAIL_LABEL_NOT_FOUND",
      });
    }

    const canonicalName = canonicalProfileLabelName(organization.name);
    const normalizedName = profileLabelIdentity(canonicalName);
    const candidates = labels.filter(
      (label) =>
        label.type === "user" &&
        isCurrentProfileLabelPath(label.name) &&
        profileLabelIdentity(label.name) === normalizedName,
    );
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

    let created: GoogleLabelSummary;
    try {
      created = await this.gmail.createLabel(canonicalName);
    } catch (error) {
      if (errorCode(error) !== "GOOGLE_WORKSPACE_GMAIL_LABEL_CONFLICT") {
        throw error;
      }
      const refreshed = (await this.gmail.listLabels()).filter(
        (label) =>
          label.type === "user" &&
          isCurrentProfileLabelPath(label.name) &&
          profileLabelIdentity(label.name) === normalizedName,
      );
      if (refreshed.length > 1) return this.conflict(input, refreshed);
      const winner = refreshed[0];
      if (!winner) {
        throw new Error("GOOGLE_WORKSPACE_GMAIL_RETRYABLE_FAILURE");
      }
      const owner = await this.repository.findByLabelId({
        connectionId: input.connectionId,
        gmailLabelId: winner.id,
      });
      if (owner && owner.organizationId !== input.organizationId) {
        return this.conflict(input, [winner]);
      }
      try {
        return {
          status: "resolved",
          mapping: await this.repository.adopt({
            ...input,
            gmailLabelId: winner.id,
            gmailLabelName: winner.name,
          }),
        };
      } catch (adoptError) {
        if (
          errorCode(adoptError) ===
          "GOOGLE_WORKSPACE_PROFILE_LABEL_CONFLICT"
        ) {
          return this.conflict(input, [winner]);
        }
        throw adoptError;
      }
    }
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
        isCurrentProfileLabelPath(label.name) &&
        profileLabelIdentity(label.name) === profileLabelIdentity(canonicalName),
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
