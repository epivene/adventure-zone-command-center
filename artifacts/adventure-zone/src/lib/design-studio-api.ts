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
    return apiPost<Record<string, unknown>>(`/office/design-studio/projects/${encodeURIComponent(id)}/contract/prepare`, {});
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