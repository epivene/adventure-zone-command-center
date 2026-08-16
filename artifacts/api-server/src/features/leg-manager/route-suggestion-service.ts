import type {
  CreateManagerRouteSuggestionInput,
  ManagerRouteSuggestion,
  ManagerRouteSuggestionStore,
  ManagerRouteSuggestionTarget,
} from "./route-suggestion-repository";

export type RouteSuggestionTargetSnapshot = {
  legIds: string[];
  snapshot: Record<string, unknown>;
};

export interface RouteSuggestionTargetResolver {
  resolve(targetType: ManagerRouteSuggestionTarget, targetId: string): Promise<RouteSuggestionTargetSnapshot | null>;
}

export interface RouteSuggestionMutationAdapter {
  apply(suggestion: ManagerRouteSuggestion): Promise<{ ok: true } | { ok: false; error: string }>;
}

export type SubmitManagerSuggestionInput = {
  managerLegId: string;
  managerId?: string | null;
  targetType: ManagerRouteSuggestionTarget;
  targetId: string;
  kind: string;
  proposedJson: Record<string, unknown>;
  reason: string;
};

function sameJson(left: Record<string, unknown> | null, right: Record<string, unknown>): boolean {
  if (!left) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

export class ManagerRouteSuggestionService {
  constructor(
    private readonly repository: ManagerRouteSuggestionStore,
    private readonly targets: RouteSuggestionTargetResolver,
    private readonly mutations: RouteSuggestionMutationAdapter,
  ) {}

  async submitManagerSuggestion(input: SubmitManagerSuggestionInput): Promise<ManagerRouteSuggestion> {
    const target = await this.targets.resolve(input.targetType, input.targetId);
    if (!target) throw new Error("Route target could not be found.");
    if (!target.legIds.includes(input.managerLegId)) throw new Error("Route target is outside your leg.");
    if (!input.reason.trim()) throw new Error("Explain why this route change is needed.");
    if (!input.kind.trim()) throw new Error("Choose a route change.");
    if (!Object.keys(input.proposedJson).length) throw new Error("Proposed route change is required.");

    const createInput: CreateManagerRouteSuggestionInput = {
      legId: input.managerLegId,
      submittedByManagerId: input.managerId ?? null,
      targetType: input.targetType,
      targetId: input.targetId,
      kind: input.kind.trim(),
      beforeJson: target.snapshot,
      proposedJson: input.proposedJson,
      reason: input.reason.trim(),
    };
    return this.repository.create(createInput);
  }

  listForManager(legId: string) { return this.repository.listForLeg(legId); }
  listPendingForAdmin() { return this.repository.listPending(); }

  async approveAdminSuggestion(input: { suggestionId: string; reviewedBy: string | null }) {
    const suggestion = await this.repository.get(input.suggestionId);
    if (!suggestion || suggestion.status !== "pending") return { ok: false as const, code: "NOT_PENDING" as const };

    const target = await this.targets.resolve(suggestion.targetType, suggestion.targetId);
    if (!target || !target.legIds.includes(suggestion.legId)) {
      await this.repository.markStale(suggestion.id);
      return { ok: false as const, code: "STALE" as const };
    }
    if (!sameJson(suggestion.beforeJson, target.snapshot)) {
      await this.repository.markStale(suggestion.id);
      return { ok: false as const, code: "STALE" as const };
    }

    const applied = await this.mutations.apply(suggestion);
    if (!applied.ok) return { ok: false as const, code: "APPLY_FAILED" as const, error: applied.error };
    const reviewed = await this.repository.markApproved(suggestion.id, input.reviewedBy);
    return reviewed ? { ok: true as const, suggestion: reviewed } : { ok: false as const, code: "NOT_PENDING" as const };
  }

  async rejectAdminSuggestion(input: { suggestionId: string; reviewedBy: string | null; adminResponse?: string | null }) {
    const suggestion = await this.repository.markRejected(input.suggestionId, input.reviewedBy, input.adminResponse ?? null);
    return suggestion ? { ok: true as const, suggestion } : { ok: false as const, code: "NOT_PENDING" as const };
  }
}
