import { apiDelete, apiFetch, apiGet, apiPatch, apiPost } from "@/lib/auth-token";

export const DESIGN_TYPES = ["flyer", "social post", "email", "brochure", "review request", "contract", "blank"] as const;
export type DesignType = (typeof DESIGN_TYPES)[number];

export type DesignProject = {
  id: string;
  name: string;
  type: DesignType;
  status?: "draft" | "ready" | "used" | "sent" | "archived";
  syncState?: "synced" | "pending" | "failed";
  updatedAt?: string;
  content?: string;
  notes?: string;
  canvas?: Record<string, unknown> | null;
  linkedOrganizationId?: string | null;
  linkedContactId?: string | null;
};

export type DesignTemplate = {
  id: string;
  name: string;
  type: DesignType;
  description?: string | null;
  tags?: string[];
  visibility?: "private" | "shared" | "approved";
  isApproved?: boolean;
  isFavorite?: boolean;
};

export type CreateDesignProjectInput = Pick<DesignProject, "name" | "type"> & {
  content?: string;
  canvas?: Record<string, unknown>;
  linkedOrganizationId?: string;
  linkedContactId?: string;
};

export type DesignAsset = {
  id: string;
  name: string;
  scope: "company" | "package" | "project" | "event" | "profile";
  mimeType?: string | null;
  altText?: string | null;
  storageKey?: string | null;
  url?: string | null;
};

export type CanvaConnectionStatus = {
  configured: boolean;
  connected: boolean;
  scopes: string[];
  requiredScopes?: string[];
};

export type CanvaProjectState = {
  configured: boolean;
  connected: boolean;
  linked: boolean;
  designId: string | null;
  importedVersionId: string | null;
  currentVersionId: string | null;
  outdated: boolean;
  linkStatus: "ready" | "failed" | null;
  lastError: string | null;
};

export type CanvaImportResult = {
  designId: string;
  editUrl: string;
  importedVersionId: string;
};

export type ContractAgreementState =
  | "draft" | "ready" | "pending_customer" | "customer_signed"
  | "countersign_pending" | "completed" | "declined" | "cancelled"
  | "expired" | "failed" | "replaced";

export type ContractAgreement = {
  id: string;
  projectId: string;
  state: ContractAgreementState;
  customerName: string;
  customerEmail: string;
  davidName: string;
  davidEmail: string;
  providerAgreementId: string | null;
  sentAt: string | null;
  customerSignedAt: string | null;
  completedAt: string | null;
  failureDetails: string | null;
  signedPdfAvailable: boolean;
  auditTrailAvailable: boolean;
};

export type ContractReadiness = {
  draftingAvailable: true;
  signApiAvailable: boolean;
  reason: string;
  missing: string[];
};

export type DesignEmailDeliveryDraft = {
  id: string;
  state: "draft" | "submitted" | "needs_changes" | "gmail_draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  recipientEmail: string;
  subject: string;
  scheduledFor: string | null;
  businessTimeZone: string | null;
  gmailDraftId: string | null;
  gmailMessageId: string | null;
  gmailThreadId: string | null;
  lastFailureCode: string | null;
  lastFailureMessage: string | null;
};

export type DesignEmailDeliveryStatus = {
  recipientEmail: string | null;
  draft: DesignEmailDeliveryDraft | null;
  gmailConnected: boolean;
  approvalRequired: boolean;
  approvalCurrent: boolean;
  approvedFingerprint: string | null;
};

export function assetImageUrl(asset: DesignAsset): string | null {
  if (asset.url) return asset.url;
  return null;
}

export function isStableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  if (/[?&](x-goog-|x-amz-|signature=|expires=|token=|se=|sig=)/i.test(url)) {
    return false;
  }
  return /^(https?:\/\/|\/|data:)/i.test(url);
}

export function resolveImageSrc(
  node: { assetId: string | null; src: string | null },
  assets: DesignAsset[],
): string | null {
  if (node.assetId) {
    const asset = assets.find((a) => a.id === node.assetId);
    if (asset) return assetImageUrl(asset);
    return isStableImageUrl(node.src) ? node.src : null;
  }
  return isStableImageUrl(node.src) ? node.src : null;
}

export function isImageAsset(asset: DesignAsset): boolean {
  if (asset.mimeType) return asset.mimeType.startsWith("image/");
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(asset.name);
}

type CollectionResponse = DesignProject[] | { projects?: DesignProject[]; data?: DesignProject[] };

function projectsFromResponse(response: CollectionResponse): DesignProject[] {
  if (Array.isArray(response)) return response;
  return response.projects ?? response.data ?? [];
}

async function responseError(res: Response, fallback: string) {
  const payload = await res.json().catch(() => ({})) as { error?: string };
  return new Error(payload.error ?? fallback);
}

export const designStudioApi = {
  async list(): Promise<DesignProject[]> {
    return projectsFromResponse(await apiGet<CollectionResponse>("/office/design-studio/projects"));
  },
  async listTemplates(): Promise<DesignTemplate[]> {
    const response = await apiGet<{ templates: DesignTemplate[] }>("/office/design-studio/templates");
    return response.templates ?? [];
  },
  async listAssets(): Promise<DesignAsset[]> {
    const response = await apiGet<{ assets: DesignAsset[] }>("/office/design-studio/assets");
    return response.assets ?? [];
  },
  favoriteTemplate(id: string) {
    return apiPost<{ isFavorite: boolean }>(`/office/design-studio/templates/${encodeURIComponent(id)}/favorite`, {});
  },
  duplicate(id: string, name?: string) {
    return apiPost<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}/duplicate`, name ? { name } : {});
  },
  repurpose(id: string, name?: string) {
    return apiPost<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}/repurpose`, name ? { name } : {});
  },
  reopen(id: string) {
    return apiPost<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}/reopen`, {});
  },
  createOutput(id: string, outputType: "preview" | "export" | "gmail_draft" | "review_request" | "contract") {
    return apiPost<Record<string, unknown>>(`/office/design-studio/projects/${encodeURIComponent(id)}/outputs`, { outputType });
  },
  prepareContract(id: string) {
    return apiPost<{ agreement: ContractAgreement; readiness: ContractReadiness }>(`/office/design-studio/projects/${encodeURIComponent(id)}/contract/prepare`, {});
  },
  contractState(id: string) {
    return apiGet<{ agreements: ContractAgreement[]; readiness: ContractReadiness }>(`/office/design-studio/projects/${encodeURIComponent(id)}/contracts`);
  },
  sendContract(id: string) {
    return apiPost<{ agreement: ContractAgreement }>(`/office/contracts/${encodeURIComponent(id)}/send`, {});
  },
  refreshContract(id: string) {
    return apiPost<{ agreement: ContractAgreement }>(`/office/contracts/${encodeURIComponent(id)}/refresh`, {});
  },
  cancelContract(id: string, reason: string) {
    return apiPost<{ agreement: ContractAgreement }>(`/office/contracts/${encodeURIComponent(id)}/cancel`, { reason });
  },
  replaceContract(id: string) {
    return apiPost<{ project: DesignProject }>(`/office/contracts/${encodeURIComponent(id)}/replace`, {});
  },
  async contractFile(id: string, kind: "signed" | "audit") {
    const result = await apiGet<{ url: string }>(`/office/contracts/${encodeURIComponent(id)}/file/${kind}`);
    window.open(result.url, "_blank", "noopener,noreferrer");
  },
  async get(id: string) {
    const response = await apiGet<{ project: DesignProject }>(`/office/design-studio/projects/${encodeURIComponent(id)}`);
    return response.project;
  },
  create(input: CreateDesignProjectInput) {
    return apiPost<DesignProject>("/office/design-studio/projects", input);
  },
  update(
    id: string,
    input: Partial<Pick<DesignProject, "name" | "type" | "content" | "notes" | "status" | "canvas" | "syncState">>,
  ) {
    return apiPatch<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}`, input);
  },
  emailStatus(id: string) {
    return apiGet<DesignEmailDeliveryStatus>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/status`);
  },
  saveEmailInApp(id: string, subject: string) {
    return apiPost<{ draft: DesignEmailDeliveryDraft }>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/save`, { subject });
  },
  createGmailDraft(id: string, subject: string) {
    return apiPost<{ draft: DesignEmailDeliveryDraft }>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/gmail-draft`, { subject });
  },
  reviewEmailContent(draftId: string) {
    return apiPost<{ digest: string; approvalCurrent: boolean }>(`/outreach-planner/drafts/office_email/${encodeURIComponent(draftId)}/review-content`, {});
  },
  approveEmailContent(draftId: string, digest: string) {
    return apiFetch(`/outreach-planner/drafts/office_email/${encodeURIComponent(draftId)}/approval`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ digest, intent: "exploratory", holdId: null, stage: "initial", overrides: {}, reason: "Approved in Design Studio for exact delivery." }),
    }).then(async (response) => {
      if (!response.ok) throw await responseError(response, "Could not approve this email.");
      return response.json() as Promise<{ digest: string }>;
    });
  },
  scheduleEmail(id: string, input: { subject: string; requestKey: string; approvedFingerprint: string; scheduledFor: string; businessTimeZone: string }) {
    return apiPost<{ draft: DesignEmailDeliveryDraft }>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/schedule`, input);
  },
  rescheduleEmail(id: string, input: { subject: string; requestKey: string; approvedFingerprint: string; scheduledFor: string; businessTimeZone: string }) {
    return apiPost<{ draft: DesignEmailDeliveryDraft }>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/reschedule`, input);
  },
  cancelScheduledEmail(id: string) {
    return apiPost<{ draft: DesignEmailDeliveryDraft }>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/cancel`, {});
  },
  sendEmailNow(id: string, input: { subject: string; requestKey: string; approvedFingerprint: string }) {
    return apiPost<{ draft: DesignEmailDeliveryDraft }>(`/office/design-studio/projects/${encodeURIComponent(id)}/email/send`, input);
  },
  remove(id: string) {
    return apiDelete<{ ok: boolean }>(`/office/design-studio/projects/${encodeURIComponent(id)}`);
  },
  canvaStatus() {
    return apiGet<CanvaConnectionStatus>("/office/design-studio/canva/status");
  },
  startCanvaConnect(returnPath: string) {
    return apiPost<{ authorizationUrl: string }>("/office/design-studio/canva/connect", { returnPath });
  },
  disconnectCanva() {
    return apiDelete<{ ok: boolean }>("/office/design-studio/canva/connection");
  },
  getCanvaState(id: string) {
    return apiGet<CanvaProjectState>(`/office/design-studio/projects/${encodeURIComponent(id)}/canva`);
  },
  getCanvaEditUrl(id: string) {
    return apiGet<{ editUrl: string; designId: string }>(`/office/design-studio/projects/${encodeURIComponent(id)}/canva/edit-url`);
  },
  async importToCanva(id: string, pdf: Blob): Promise<CanvaImportResult> {
    const res = await apiFetch(`/office/design-studio/projects/${encodeURIComponent(id)}/canva/import`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: pdf,
    });
    if (!res.ok) throw await responseError(res, `Canva import failed (${res.status}).`);
    return res.json() as Promise<CanvaImportResult>;
  },
};
