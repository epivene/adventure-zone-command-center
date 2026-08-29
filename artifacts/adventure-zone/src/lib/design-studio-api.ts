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

export type DesignAsset = {
  id: string;
  name: string;
  scope: "company" | "package" | "project" | "event" | "profile";
  mimeType?: string | null;
  altText?: string | null;
};

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
  create(input: Pick<DesignProject, "name" | "type">) {
    return apiPost<DesignProject>("/office/design-studio/projects", input);
  },
  update(id: string, input: Partial<Pick<DesignProject, "name" | "type" | "content" | "notes" | "status">>) {
    return apiPatch<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}`, input);
  },
  remove(id: string) {
    return apiDelete<{ ok: boolean }>(`/office/design-studio/projects/${encodeURIComponent(id)}`);
  },
};