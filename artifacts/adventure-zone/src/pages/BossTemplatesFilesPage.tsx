import { useEffect, useState } from "react";
import { FileText, RefreshCw, Star } from "lucide-react";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossDesignStudioApi } from "@/lib/boss-design-studio-api";
import type { DesignTemplate } from "@/lib/design-studio-api";

export default function BossTemplatesFilesPage() {
  const [templates, setTemplates] = useState<DesignTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [favoritingId, setFavoritingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await bossDesignStudioApi.listTemplates();
      setTemplates(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function toggleFavorite(template: DesignTemplate) {
    setFavoritingId(template.id);
    try {
      const result = await bossDesignStudioApi.favoriteTemplate(template.id);
      setTemplates((items) =>
        items.map((t) => t.id === template.id ? { ...t, isFavorite: result.isFavorite } : t)
      );
    } catch {
      // fail silently
    } finally {
      setFavoritingId(null);
    }
  }

  return (
    <div className="grid gap-5" data-testid="boss-templates-files-page">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-primary">Boss</p>
          <h1 className="mt-0.5 text-2xl font-bold text-foreground">Templates &amp; Files</h1>
          <p className="mt-1 text-sm text-muted-foreground">Studio templates, contracts, and source files.</p>
        </div>
        <Button onClick={() => void load()} variant="outline" size="sm" disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm" role="alert">
          <span className="text-destructive">{error}</span>
          <Button onClick={() => void load()} variant="outline" size="sm" className="ml-3">
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center" data-testid="templates-empty">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 font-semibold text-foreground">No templates yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">Templates created in Design Studio will appear here.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <article
              key={template.id}
              className="rounded-xl border border-border bg-card p-4 shadow-sm"
              data-testid={`template-card-${template.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-foreground">{template.name}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground capitalize">{template.type}</p>
                </div>
                <button
                  aria-label={template.isFavorite ? "Unfavorite" : "Favorite"}
                  className="shrink-0 text-muted-foreground hover:text-accent transition-colors"
                  disabled={favoritingId === template.id}
                  onClick={() => void toggleFavorite(template)}
                  type="button"
                  data-testid={`button-favorite-${template.id}`}
                >
                  <Star
                    className={`h-4 w-4 ${template.isFavorite ? "fill-accent text-accent" : ""}`}
                  />
                </button>
              </div>
              {template.description ? (
                <p className="mt-2 text-sm text-muted-foreground">{template.description}</p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1">
                {template.visibility ? (
                  <Badge variant="outline" className="capitalize text-xs">{template.visibility}</Badge>
                ) : null}
                {template.isApproved ? (
                  <Badge variant="default" className="text-xs">Approved</Badge>
                ) : null}
                {(template.tags ?? []).map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
