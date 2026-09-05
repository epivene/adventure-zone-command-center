// Shared types for the marketing campaign workspace.
// All types reflect the real server API contracts exactly.

export type Area = "email" | "promos" | "audiences" | "history";

export type ServerAudience = {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Member as returned by GET /marketing/audiences/:id */
export type AudienceMemberDetail = {
  organizationId: string;
  contactId: string;
  organizationName: string;
  contactName: string;
  email: string;
  membershipActive: boolean;
};

export type AudienceDetail = {
  audience: ServerAudience;
  members: AudienceMemberDetail[];
};

/** A selected member in the audience form. Composite key: organizationId + contactId. */
export type SelectedMember = {
  organizationId: string;
  contactId: string;
  orgName: string;
  contactName: string;
  email: string;
};

export type Template = {
  id: string;
  name: string;
  code: string;
  templateVersion: string;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  requiredPlaceholders: string[] | null;
};

export type CampaignState =
  | "draft"
  | "needs_review"
  | "approved"
  | "scheduled"
  | "sending"
  | "sent"
  | "failed"
  | "cancelled";

export type CampaignCore = {
  id: string;
  name: string;
  state: CampaignState;
  audienceId: string;
  templateId: string;
  senderName: string;
  senderEmail: string | null;
  senderPhone: string | null;
  subjectTemplate: string | null;
  bodyTemplate: string | null;
  templateNameSnapshot: string | null;
  snapshotRecipientCount: number | null;
  snapshotExcluded: Array<Record<string, unknown>>;
  requestedReviewAt: string | null;
  approvedAt: string | null;
  scheduledFor: string | null;
  sentAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CampaignSummary = {
  campaign: CampaignCore;
  audienceName: string;
  templateName: string;
  recipientCount: number;
  deliverySentCount: number;
};

export type CampaignDetail = {
  campaign: CampaignCore;
  counts: { recipients: number; sent: number; failed: number };
  events: Array<{
    id: string;
    eventType: string;
    actorId: string;
    details: Record<string, unknown>;
    createdAt: string;
  }>;
  recipients: Array<{
    id: string;
    recipientEmail: string;
    organizationName: string;
    contactName: string;
  }>;
  exclusions: Array<Record<string, unknown>>;
};

export type PreflightResult = {
  recipients: Array<{
    organizationId: string;
    contactId: string;
    email: string;
    organizationName: string;
    contactName: string;
  }>;
  excluded: Array<{
    organizationId: string;
    contactId: string;
    email: string;
    reason: string;
  }>;
  totalMembers: number;
};

/** Contact returned inside GET /organizations/:id */
export type OrgContact = {
  id: string;
  firstName: string;
  lastName: string;
  role: string | null;
  isPrimary: boolean;
  email: string | null;
};

/** Record returned inside GET /organizations (the records array). */
export type OrgRecord = {
  id: string;
  name: string;
  email: string | null;
  city: string | null;
  region: string | null;
  placeType: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const STATE_LABELS: Record<CampaignState, string> = {
  draft: "Draft",
  needs_review: "Needs Review",
  approved: "Approved",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function stateBadgeVariant(
  state: CampaignState,
): "default" | "secondary" | "destructive" | "outline" {
  if (state === "sent") return "default";
  if (state === "failed" || state === "cancelled") return "destructive";
  if (state === "needs_review" || state === "approved") return "secondary";
  return "outline";
}

export function unresolvedTokens(text: string): string[] {
  const matches = text.match(/\{\{[a-zA-Z][a-zA-Z0-9]*\}\}/g) ?? [];
  return [...new Set(matches)];
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function exclusionReasonLabel(reason: string): string {
  const map: Record<string, string> = {
    inactive_organization: "Inactive organization",
    inactive_membership: "Inactive membership",
    missing_email: "No email",
    invalid_email: "Invalid email",
    communication_block: "Communication block",
    duplicate_email: "Duplicate email",
  };
  return map[reason] ?? reason;
}

/** Composite key for a member: organizationId + contactId. */
export function memberKey(organizationId: string, contactId: string): string {
  return `${organizationId}::${contactId}`;
}

// Local-only promos (browser state, separate from server persistence)
export type Promo = {
  id: string;
  title: string;
  kind: string;
  notes: string;
  createdAt: string;
};

export const PROMO_KEY = "adventure-zone-promos-v1";

export function readPromos(): Promo[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(PROMO_KEY) ?? "null");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

export function writePromos(promos: Promo[]): void {
  try {
    window.localStorage.setItem(PROMO_KEY, JSON.stringify(promos));
  } catch {
    /* ignore */
  }
}

export type NoticeDispatch = (
  n: { kind: "ok" | "error"; text: string } | null,
) => void;
