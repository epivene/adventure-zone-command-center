import {
  createAiClient,
  type AiCompletionClient,
} from "@/features/ai-suggestions/ai-client";

import type {
  GoogleLabelSummary,
  GoogleMessageMetadata,
  GoogleWorkspaceReadClient,
} from "./google-api-types";
import { matchGoogleBodyToProfiles } from "./google-body-profile-matcher";
import {
  GoogleContactProfileResolver,
  type ContactProfileResolution,
} from "./google-contact-profile-resolver";
import {
  businessHintLabelIds,
  PostgresGoogleValidationEvidenceRepository,
  type GoogleValidationEvidenceSnapshot,
} from "./google-recent-validation-service";
import {
  classifyGoogleMessageRelevance,
  type GoogleRelevanceCandidate,
  type GoogleRelevanceResult,
} from "./google-relevance-classifier";
import { GoogleScopeService } from "./google-scope-service";
import {
  GoogleValidationLearningRepository,
  type GoogleLearnedProfileTarget,
} from "./google-validation-learning-repository";
import { triageGoogleEmailWithAi } from "./google-ai-email-triage";

const MAX_BODY_CHARS = 18_000;

export type GoogleHistoricalClassification =
  | {
      outcome: "attached";
      organization: { id: string; name: string };
      evidenceCodes: string[];
    }
  | {
      outcome: "ignored";
      evidenceCodes: string[];
    }
  | {
      outcome: "needs_review";
      candidates: Array<{ id: string; name: string }>;
      evidenceCodes: string[];
    };

export type GoogleHistoricalClassifierContext = {
  approvedLabelIds: Set<string>;
  mailboxEmails: Set<string>;
  contacts: GoogleValidationEvidenceSnapshot["contacts"];
  organizations: GoogleValidationEvidenceSnapshot["organizations"];
  profiles: GoogleValidationEvidenceSnapshot["profiles"];
  threadTargets: Map<string, GoogleLearnedProfileTarget>;
  addressTargets: Map<string, GoogleLearnedProfileTarget>;
};

type ContactResolverAccess = {
  resolve(contactId: string): Promise<ContactProfileResolution>;
};

type ContextLoader = (
  client: GoogleWorkspaceReadClient,
) => Promise<GoogleHistoricalClassifierContext>;

function aiEnabledFromEnv(): boolean {
  return process.env.GOOGLE_WORKSPACE_AI_ENABLED?.trim().toLowerCase() === "true";
}

function uniqueProfiles(
  candidates: GoogleRelevanceCandidate[],
  extras: Array<{ id: string; name: string }> = [],
): Array<{ id: string; name: string }> {
  const unique = new Map<string, { id: string; name: string }>();
  for (const candidate of candidates) {
    if (
      (candidate.kind === "profile" || candidate.kind === "organization") &&
      !candidate.name.trim().toLowerCase().startsWith("adventure zone")
    ) {
      unique.set(candidate.id, { id: candidate.id, name: candidate.name });
    }
  }
  for (const candidate of extras) {
    if (!candidate.name.trim().toLowerCase().startsWith("adventure zone")) {
      unique.set(candidate.id, candidate);
    }
  }
  return [...unique.values()].slice(0, 12);
}

function directTarget(result: GoogleRelevanceResult): { id: string; name: string } | null {
  const direct = uniqueProfiles(result.candidates);
  return direct.length === 1 ? direct[0] : null;
}

async function readableBody(
  client: GoogleWorkspaceReadClient,
  threadId: string,
): Promise<string> {
  if (!client.getThreadDetail) return "";
  try {
    const thread = await client.getThreadDetail(threadId);
    return thread.messages
      .map((message) => message.bodyText)
      .join("\n")
      .slice(0, MAX_BODY_CHARS);
  } catch {
    return "";
  }
}

function mergeReview(
  original: GoogleRelevanceResult,
  body: ReturnType<typeof matchGoogleBodyToProfiles>,
): GoogleRelevanceResult {
  const candidates = new Map<string, GoogleRelevanceCandidate>();
  for (const candidate of [...original.candidates, ...body.candidates]) {
    candidates.set(`${candidate.kind}:${candidate.id}`, candidate);
  }
  return {
    status: "review",
    evidenceCodes: [...new Set([...original.evidenceCodes, ...body.evidenceCodes])],
    candidates: [...candidates.values()],
  };
}

async function defaultContextLoader(
  client: GoogleWorkspaceReadClient,
): Promise<GoogleHistoricalClassifierContext> {
  const scope = new GoogleScopeService();
  const evidence = new PostgresGoogleValidationEvidenceRepository();
  const learning = new GoogleValidationLearningRepository();
  const [saved, snapshot, learned, labels, identity] = await Promise.all([
    scope.getSaved(),
    evidence.load(),
    learning.load(),
    client.listLabels(),
    client.accountIdentity(),
  ]);
  const approvedLabelIds = new Set(saved.labels.map((label) => label.id));
  for (const id of businessHintLabelIds(labels as GoogleLabelSummary[])) {
    approvedLabelIds.add(id);
  }
  return {
    approvedLabelIds,
    mailboxEmails: new Set([
      ...learned.mailboxEmails,
      identity.email.trim().toLowerCase(),
    ]),
    contacts: snapshot.contacts,
    organizations: snapshot.organizations,
    profiles: snapshot.profiles,
    threadTargets: learned.threadTargets,
    addressTargets: learned.addressTargets,
  };
}

export class GoogleHistoricalMessageClassifier {
  private readonly contextLoader: ContextLoader;
  private readonly contactResolver: ContactResolverAccess;
  private readonly aiFactory: () => Promise<AiCompletionClient>;
  private readonly aiEnabled: boolean;
  private contextPromise: Promise<GoogleHistoricalClassifierContext> | null = null;
  private aiPromise: Promise<AiCompletionClient | null> | null = null;

  constructor(options?: {
    contextLoader?: ContextLoader;
    contactResolver?: ContactResolverAccess;
    aiFactory?: () => Promise<AiCompletionClient>;
    aiEnabled?: boolean;
  }) {
    this.contextLoader = options?.contextLoader ?? defaultContextLoader;
    this.contactResolver = options?.contactResolver ?? new GoogleContactProfileResolver();
    this.aiFactory = options?.aiFactory ?? createAiClient;
    this.aiEnabled = options?.aiEnabled ?? aiEnabledFromEnv();
  }

  private context(client: GoogleWorkspaceReadClient) {
    this.contextPromise ??= this.contextLoader(client);
    return this.contextPromise;
  }

  private ai(): Promise<AiCompletionClient | null> {
    if (!this.aiEnabled) return Promise.resolve(null);
    this.aiPromise ??= this.aiFactory().catch(() => null);
    return this.aiPromise;
  }

  async classify(
    message: GoogleMessageMetadata,
    client: GoogleWorkspaceReadClient,
  ): Promise<GoogleHistoricalClassification> {
    const context = await this.context(client);
    const threadTarget = context.threadTargets.get(message.threadId);
    let result = classifyGoogleMessageRelevance({
      message,
      evidence: {
        approvedLabelIds: context.approvedLabelIds,
        mailboxEmails: context.mailboxEmails,
        contacts: context.contacts,
        organizations: context.organizations,
        profiles: context.profiles,
        learnedAddressTargets: context.addressTargets,
        existingThreadTarget: threadTarget
          ? { ...threadTarget, kind: "profile" as const }
          : null,
      },
    });

    let bodyText = "";
    const learnedAddressMatch =
      result.status === "matched" &&
      result.evidenceCodes.includes("learned_external_email");
    if (result.status !== "matched" || learnedAddressMatch) {
      bodyText = await readableBody(client, message.threadId);
      const bodyMatch = matchGoogleBodyToProfiles({
        bodyText,
        profiles: context.profiles,
      });
      if (bodyMatch.status === "matched") {
        result = {
          status: "matched",
          evidenceCodes: bodyMatch.evidenceCodes,
          candidates: bodyMatch.candidates,
        };
      } else if (bodyMatch.status === "review") {
        result = mergeReview(result, bodyMatch);
      }
    }

    const contactCandidates = result.candidates.filter(
      (candidate) => candidate.kind === "contact",
    );
    let contactProfileCandidates: Array<{ id: string; name: string }> = [];
    if (result.status === "matched" && contactCandidates.length === 1) {
      const resolution = await this.contactResolver.resolve(contactCandidates[0].id);
      contactProfileCandidates = resolution.candidates;
      if (resolution.status === "resolved" && resolution.organization) {
        return {
          outcome: "attached",
          organization: resolution.organization,
          evidenceCodes: [
            ...new Set([...result.evidenceCodes, "contact_active_organization"]),
          ],
        };
      }
      result = {
        status: "review",
        evidenceCodes: [
          ...new Set([
            ...result.evidenceCodes,
            resolution.status === "ambiguous"
              ? "contact_organization_ambiguous"
              : "contact_organization_unresolved",
          ]),
        ],
        candidates: result.candidates,
      };
    } else if (result.status === "matched" && contactCandidates.length > 1) {
      result = {
        status: "review",
        evidenceCodes: [
          ...new Set([...result.evidenceCodes, "multiple_exact_contact_matches"]),
        ],
        candidates: result.candidates,
      };
    }

    if (result.status === "matched") {
      const target = directTarget(result);
      if (target) {
        return {
          outcome: "attached",
          organization: target,
          evidenceCodes: result.evidenceCodes,
        };
      }
    }

    const candidates = uniqueProfiles(result.candidates, contactProfileCandidates);
    const ai = await this.ai();
    if (ai) {
      if (!bodyText) bodyText = await readableBody(client, message.threadId);
      const triage = await triageGoogleEmailWithAi({
        ai,
        subject: message.headers.subject,
        from: message.headers.from,
        to: message.headers.to,
        labels: message.labelIds,
        bodyText,
        deterministicEvidence: result.evidenceCodes,
        matchedContactName:
          contactCandidates.length === 1 ? contactCandidates[0].name : null,
        candidateProfiles: candidates,
      });
      if (triage.outcome === "match" && triage.profileId) {
        const target = candidates.find((candidate) => candidate.id === triage.profileId);
        if (target) {
          return {
            outcome: "attached",
            organization: target,
            evidenceCodes: [...new Set([...result.evidenceCodes, "ai_profile_match"])],
          };
        }
      }
      if (triage.outcome === "ignore") {
        return {
          outcome: "ignored",
          evidenceCodes: [...new Set([...result.evidenceCodes, "ai_ignore"])],
        };
      }
      if (result.status === "ignored" && triage.confidence === "low") {
        return { outcome: "ignored", evidenceCodes: result.evidenceCodes };
      }
      return {
        outcome: "needs_review",
        candidates,
        evidenceCodes: [...new Set([...result.evidenceCodes, "ai_needs_review"])],
      };
    }

    if (result.status === "ignored") {
      return { outcome: "ignored", evidenceCodes: result.evidenceCodes };
    }
    return {
      outcome: "needs_review",
      candidates,
      evidenceCodes: result.evidenceCodes,
    };
  }
}
