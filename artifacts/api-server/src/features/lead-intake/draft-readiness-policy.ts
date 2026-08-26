export const DEFAULT_AVAILABILITY_FRESHNESS_MS = 60 * 60 * 1000;

export type CommunicationBlock = {
  active: boolean;
  targetType: string;
  organizationId?: string | null;
  contactId?: string | null;
  normalizedEmail?: string | null;
  rowId?: string | null;
};

export type DraftReadinessInput = {
  rowId?: string | null;
  organizationId?: string | null;
  contactId?: string | null;
  rowState?: string | null;
  recipientEmail?: string | null;
  recipientConfirmed?: boolean;
  introductionSuitable?: boolean;
  relationshipOutcome?: string | null;
  territoryStatus?: string | null;
  fitStatus?: string | null;
  communicationBlocks?: readonly CommunicationBlock[];
  availability?: {
    ready?: boolean;
    checkedAt?: string | null;
    packageAvailability?: {
      status?: string;
      packages?: readonly { packageKey: string; availableQuantity: number }[];
      restrictedOptions?: readonly { packageKey: string; approvalRequired: true }[];
    };
  } | null;
  now?: Date;
  freshnessMs?: number;
};

export type DraftReadiness = { ready: boolean; blockers: string[] };

export function normalizeRecipientEmail(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function hasActiveBlock(input: DraftReadinessInput) {
  const recipient = normalizeRecipientEmail(input.recipientEmail);
  return input.communicationBlocks?.some((block) => {
    if (!block.active) return false;
    if (block.targetType === "internal_preview") return true;
    if (block.targetType === "organization") return Boolean(input.organizationId && block.organizationId === input.organizationId);
    if (block.targetType === "contact") return Boolean(input.contactId && block.contactId === input.contactId);
    if (block.targetType === "lead_import_row") return Boolean(input.rowId && block.rowId === input.rowId);
    return Boolean(recipient && normalizeRecipientEmail(block.normalizedEmail) === recipient);
  }) ?? false;
}

function hasNormalAvailability(input: NonNullable<DraftReadinessInput["availability"]>) {
  const restricted = new Set(input.packageAvailability?.restrictedOptions?.map((option) => option.packageKey) ?? []);
  return input.packageAvailability?.packages?.some((item) =>
    item.availableQuantity > 0 && item.packageKey !== "mini_zone" && !restricted.has(item.packageKey),
  ) ?? false;
}

export function evaluateDraftReadiness(input: DraftReadinessInput): DraftReadiness {
  const blockers: string[] = [];
  if (hasActiveBlock(input)) blockers.push("do_not_send");
  if (input.rowState !== "verified") blockers.push("lead_not_verified");
  if (!normalizeRecipientEmail(input.recipientEmail) || !input.recipientConfirmed) blockers.push("recipient_not_verified");
  if (!input.introductionSuitable) blockers.push("introduction_not_suitable");

  if (input.relationshipOutcome === "needs_review" || !input.relationshipOutcome) blockers.push("relationship_needs_review");
  else if (input.relationshipOutcome !== "new_introduction") blockers.push("template_not_approved");

  if (input.territoryStatus !== "open") blockers.push("territory_not_open");
  if (input.fitStatus !== "approved") blockers.push("fit_not_approved");

  const availability = input.availability;
  if (!availability?.ready || !availability.checkedAt || !availability.packageAvailability) {
    blockers.push("availability_not_ready");
  } else {
    const checkedAt = Date.parse(availability.checkedAt);
    const age = (input.now ?? new Date()).getTime() - checkedAt;
    if (!Number.isFinite(checkedAt) || age > (input.freshnessMs ?? DEFAULT_AVAILABILITY_FRESHNESS_MS)) {
      blockers.push("availability_stale");
    }
    if (availability.packageAvailability.status !== "resolved") blockers.push("availability_unresolved");
    if (!hasNormalAvailability(availability)) blockers.push("no_normal_package_available");
  }

  return { ready: blockers.length === 0, blockers };
}
