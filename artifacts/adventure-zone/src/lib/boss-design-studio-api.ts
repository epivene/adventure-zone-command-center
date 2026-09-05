// Boss-token-aware wrapper for the Design Studio API.
// The backend accepts a Boss bearer token on the same /api/office/design-studio endpoints.
import { bossFetch } from "@/lib/boss-auth-context";
import type {
  CanvaProjectState,
  DesignAsset,
  DesignProject,
  DesignTemplate,
  CreateDesignProjectInput,
  CanvaImportResult,
} from "@/lib/design-studio-api";

type CollectionResponse = DesignProject[] | { projects?: DesignProject[]; data?: DesignProject[] };

function projectsFromResponse(res: CollectionResponse): DesignProject[] {
  if (Array.isArray(res)) return res;
  return res.projects ?? res.data ?? [];
}

async function bossJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(payload.error ?? `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function bossGet<T>(path: string): Promise<T> {
  return bossJson<T>(await bossFetch(path));
}

async function bossPost<T>(path: string, body: unknown): Promise<T> {
  return bossJson<T>(await bossFetch(path, { method: "POST", body: JSON.stringify(body) }));
}

async function bossPatch<T>(path: string, body: unknown): Promise<T> {
  return bossJson<T>(await bossFetch(path, { method: "PATCH", body: JSON.stringify(body) }));
}

async function bossDeleteReq<T>(path: string): Promise<T> {
  return bossJson<T>(await bossFetch(path, { method: "DELETE" }));
}

export const bossDesignStudioApi = {
  async list(): Promise<DesignProject[]> {
    return projectsFromResponse(await bossGet<CollectionResponse>("/office/design-studio/projects"));
  },
  async listTemplates(): Promise<DesignTemplate[]> {
    const res = await bossGet<{ templates: DesignTemplate[] }>("/office/design-studio/templates");
    return res.templates ?? [];
  },
  async listAssets(): Promise<DesignAsset[]> {
    const res = await bossGet<{ assets: DesignAsset[] }>("/office/design-studio/assets");
    return res.assets ?? [];
  },
  async get(id: string): Promise<DesignProject> {
    const res = await bossGet<{ project: DesignProject }>(`/office/design-studio/projects/${encodeURIComponent(id)}`);
    return res.project;
  },
  create(input: CreateDesignProjectInput): Promise<DesignProject> {
    return bossPost<DesignProject>("/office/design-studio/projects", input);
  },
  update(
    id: string,
    input: Partial<Pick<DesignProject, "name" | "type" | "content" | "notes" | "status" | "canvas" | "syncState">>,
  ): Promise<DesignProject> {
    return bossPatch<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}`, input);
  },
  remove(id: string): Promise<{ ok: boolean }> {
    return bossDeleteReq<{ ok: boolean }>(`/office/design-studio/projects/${encodeURIComponent(id)}`);
  },
  duplicate(id: string, name?: string): Promise<DesignProject> {
    return bossPost<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}/duplicate`, name ? { name } : {});
  },
  repurpose(id: string, name?: string): Promise<DesignProject> {
    return bossPost<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}/repurpose`, name ? { name } : {});
  },
  reopen(id: string): Promise<DesignProject> {
    return bossPost<DesignProject>(`/office/design-studio/projects/${encodeURIComponent(id)}/reopen`, {});
  },
  getCanvaState(id: string): Promise<CanvaProjectState> {
    return bossGet<CanvaProjectState>(`/office/design-studio/projects/${encodeURIComponent(id)}/canva`);
  },
  getCanvaEditUrl(id: string): Promise<{ editUrl: string; designId: string }> {
    return bossGet<{ editUrl: string; designId: string }>(`/office/design-studio/projects/${encodeURIComponent(id)}/canva/edit-url`);
  },
  startCanvaConnect(returnPath: string): Promise<{ authorizationUrl: string }> {
    return bossPost<{ authorizationUrl: string }>("/office/design-studio/canva/connect", { returnPath });
  },
  async importToCanva(id: string, pdf: Blob): Promise<CanvaImportResult> {
    const res = await bossFetch(`/office/design-studio/projects/${encodeURIComponent(id)}/canva/import`, {
      method: "POST",
      headers: { "Content-Type": "application/pdf" },
      body: pdf,
    });
    if (!res.ok) {
      const payload = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(payload.error ?? `Canva import failed (${res.status}).`);
    }
    return res.json() as Promise<CanvaImportResult>;
  },
  favoriteTemplate(id: string): Promise<{ isFavorite: boolean }> {
    return bossPost<{ isFavorite: boolean }>(`/office/design-studio/templates/${encodeURIComponent(id)}/favorite`, {});
  },
};
