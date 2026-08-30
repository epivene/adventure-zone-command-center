import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/auth-token";

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
  /** Object-storage key the API returns for stored asset bytes, if any. */
  storageKey?: string | null;
  /** Absolute or app-relative URL to the asset content, if the API supplies one. */
  url?: string | null;
};

/**
 * Resolve a usable image URL for a Studio asset for RENDERING ONLY.
 *
 * The value this returns may be a short-lived signed URL and MUST NOT be
 * persisted into the saved canvas document (see `resolveImageSrc`). At save
 * time only `assetId` is stored for Studio assets; the URL is re-resolved from
 * the loaded asset list every render so an expired signature can never be
 * baked into the document.
 */
export function assetImageUrl(asset: DesignAsset): string | null {
  if (asset.url) return asset.url;
  return null;
}

/**
 * Whether a URL is safe to persist directly in `ImageNode.src`. Signed
 * object-storage URLs (query string with an expiry/signature) are ephemeral and
 * must never be stored; only genuinely stable absolute or app-relative URLs
 * qualify.
 */
export function isStableImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // Reject anything that looks like a signed URL (expiry/signature params).
  if (/[?&](x-goog-|x-amz-|signature=|expires=|token=|se=|sig=)/i.test(url)) {
    return false;
  }
  // Data URIs and plain http(s)/relative URLs without signing params are stable.
  return /^(https?:\/\/|\/|data:)/i.test(url);
}

/**
 * Resolve the image URL to render for an ImageNode, at render time. Studio
 * assets (identified by `assetId`) are always re-resolved from the current
 * loaded asset list so a fresh signed URL is used and nothing stale is shown.
 * A node's own `src` is used only as a fallback for genuinely stable URLs.
 */
export function resolveImageSrc(
  node: { assetId: string | null; src: string | null },
  assets: DesignAsset[],
): string | null {
  if (node.assetId) {
    const asset = assets.find((a) => a.id === node.assetId);
    if (asset) return assetImageUrl(asset);
    // Asset no longer available; fall back to a stable src only.
    return isStableImageUrl(node.src) ? node.src : null;
  }
  return isStableImageUrl(node.src) ? node.src : null;
}

/** Only assets that can render as an image belong in the freeform picker. */
export function isImageAsset(asset: DesignAsset): boolean {
  if (asset.mimeType) return asset.mimeType.startsWith("image/");
  // Fall back to extension sniffing when the mime type is absent.
  return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(asset.name);
}

type CollectionResponse = DesignProject[] | { projects?: DesignProject[]; data?: DesignProject[] };

function projectsFromResponse(response: CollectionResponse): DesignProject[] {
  if (Array.isArray(response)) return response;
  return response.projects ?? response.data ?? [];
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
};