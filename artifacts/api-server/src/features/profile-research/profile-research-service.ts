import { randomUUID } from "node:crypto";

import { DrizzleEventProfileRepository, type EventProfile } from "@/features/event-profiles/event-profile-repository";
import { db } from "@/db/client";
import { buildProfileResearchContext } from "./profile-research-context";
import { OpenAiProfileResearchProvider } from "./openai-profile-research-provider";
import type { ProfileResearchProvider, ProfileResearchCandidateFact } from "./profile-research-provider";
import { ProfileResearchRepository } from "./profile-research-repository";
import type { ProfileResearchSource, ProfileResearchSuggestion, ResearchMode } from "./profile-research-types";

const ORGANIZATION_FIELDS = new Set(["website", "phone", "address1", "address2", "city", "region", "postalCode", "placeType"]);
const CONTACT_FIELDS = new Set(["name", "role", "email", "phone"]);
const BOOKING_FIELDS = new Set(["startsAt", "endsAt", "city", "region", "name"]);

function clean(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  return String(value).trim() || null;
}

function sameValue(left: string | null, right: string | null) {
  return (left ?? "").trim().toLowerCase() === (right ?? "").trim().toLowerCase();
}

function resolveCandidateTarget(profile: EventProfile, candidate: ProfileResearchCandidateFact) {
  if (candidate.targetKind === "organization") {
    if (!ORGANIZATION_FIELDS.has(candidate.field)) return null;
    return { targetId: profile.id, currentValue: clean((profile.place as any)[candidate.field]) };
  }

  if (candidate.targetKind === "contact") {
    if (!CONTACT_FIELDS.has(candidate.field)) return null;
    const contact = candidate.targetId
      ? profile.contacts.find((item) => item.id === candidate.targetId)
      : profile.contacts.find((item) => item.isPrimary) ?? profile.contacts[0];
    // Research may identify a new organizer, but Release 1 never creates a contact automatically.
    if (!contact) return null;
    return { targetId: contact.id, currentValue: clean((contact as any)[candidate.field]) };
  }

  if (!BOOKING_FIELDS.has(candidate.field)) return null;
  const booking = candidate.targetId
    ? profile.bookings.find((item) => item.id === candidate.targetId)
    : profile.bookings[0];
  // Likewise, discovered future dates do not silently create a new booking.
  if (!booking) return null;
  return { targetId: booking.id, currentValue: clean((booking as any)[candidate.field]) };
}

export class ProfileResearchService {
  constructor(
    private readonly runs = new ProfileResearchRepository(),
    private readonly provider: ProfileResearchProvider = new OpenAiProfileResearchProvider(),
    private readonly profiles = new DrizzleEventProfileRepository(db),
  ) {}

  async start(input: {
    profileId: string;
    mode: ResearchMode;
    requestedBy?: string | null;
    contactId?: string;
  }) {
    const profile = await this.profiles.getEventProfile(input.profileId, input.contactId);
    if (!profile) throw new Error("PROFILE_NOT_FOUND");

    const context = buildProfileResearchContext({ profile, mode: input.mode });
    const runId = await this.runs.createRun({
      profileId: input.profileId,
      mode: input.mode,
      requestedBy: input.requestedBy,
      context,
    });

    try {
      const result = await this.provider.research({ context, mode: input.mode });
      const sourceByUrl = new Map(
        result.sources.flatMap((source) => source.url ? [[source.url, source] as const] : []),
      );
      const suggestions: ProfileResearchSuggestion[] = result.identity.confidence === "low"
        ? []
        : result.candidates.flatMap((candidate) => {
            const resolved = resolveCandidateTarget(profile, candidate);
            if (!resolved) return [];
            const sourceIds = candidate.sourceUrls.flatMap((url) => {
              const source = sourceByUrl.get(url);
              return source ? [source.id] : [];
            });
            if (!sourceIds.length) return [];
            const suggestedValue = candidate.value.trim();
            if (!suggestedValue || sameValue(resolved.currentValue, suggestedValue)) return [];
            return [{
              id: randomUUID(),
              targetKind: candidate.targetKind,
              targetId: resolved.targetId,
              field: candidate.field,
              currentValue: resolved.currentValue,
              suggestedValue,
              confidence: result.identity.confidence,
              rationale: candidate.rationale,
              sourceIds,
              conflict: Boolean(resolved.currentValue && !sameValue(resolved.currentValue, suggestedValue)),
            }];
          });

      const summary = {
        identity: result.identity,
        deepSummary: result.deepSummary,
        searchedClues: context.searchClues,
        gapCount: context.gaps.length,
        suggestionCount: suggestions.length,
      };
      await this.runs.completeRun({
        runId,
        profileId: input.profileId,
        sources: result.sources as ProfileResearchSource[],
        suggestions,
        summary,
      });
      return await this.runs.getRun(input.profileId, runId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Public profile research failed.";
      await this.runs.failRun(runId, input.profileId, message);
      const failed = await this.runs.getRun(input.profileId, runId);
      if (failed) return failed;
      throw error;
    }
  }

  getRun(profileId: string, runId: string) {
    return this.runs.getRun(profileId, runId);
  }

  dismiss(profileId: string, runId: string, suggestionId: string) {
    return this.runs.setSuggestionReview({ profileId, runId, suggestionId, status: "dismissed" });
  }
}
