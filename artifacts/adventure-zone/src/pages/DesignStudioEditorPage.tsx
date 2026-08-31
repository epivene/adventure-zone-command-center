import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Redo2,
  RefreshCw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Link, useParams } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  designStudioApi,
  type DesignAsset,
  type DesignProject,
} from "@/lib/design-studio-api";
import { starterById } from "@/lib/design-studio/canva-starters";
import {
  normalizeCanvas,
  type CanvasDocument,
} from "@/lib/design-studio/model";
import { useFreeformEditor } from "@/components/design-studio/use-freeform-editor";
import { FreeformCanvas } from "@/components/design-studio/FreeformCanvas";

const CANVA_CREATE_URL = "https://www.canva.com/create/";
const STARTER_PREFIX = "CANVA_STARTER_ID=";
const EMPTY_CANVAS = normalizeCanvas(null);

function noteValue(notes: string | null | undefined, prefix: string) {
  return (notes ?? "")
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

export default function DesignStudioEditorPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<DesignProject | null>(null);
  const [name, setName] = useState("");
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestCanvas = useRef<CanvasDocument | null>(null);

  const canEdit = Boolean(
    project &&
      project.status !== "archived" &&
      project.status !== "used" &&
      project.status !== "sent",
  );

  const onCanvasChange = useCallback((doc: CanvasDocument) => {
    latestCanvas.current = doc;
    setDirty(true);
    setSaved(false);
  }, []);

  const editor = useFreeformEditor(canvasDoc ?? EMPTY_CANVAS, {
    canEdit,
    onChange: onCanvasChange,
  });

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);

    Promise.all([
      designStudioApi.get(params.id),
      designStudioApi.listAssets().catch(() => [] as DesignAsset[]),
    ])
      .then(([value, assetList]) => {
        setProject(value);
        setName(value.name);
        setAssets(assetList);

        const starterId = noteValue(value.notes, STARTER_PREFIX);
        const starterCanvas = starterById(starterId)?.canvas ?? null;
        const doc = normalizeCanvas(value.canvas ?? starterCanvas);
        latestCanvas.current = doc;
        setCanvasDoc(doc);
        setDirty(false);
        setSaved(false);
      })
      .catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Project could not be loaded.");
      })
      .finally(() => setLoading(false));
  }, [params.id]);

  const save = useCallback(async () => {
    if (!params.id || !project || !name.trim()) return;

    setSaving(true);
    setError(null);
    try {
      const value = await designStudioApi.update(params.id, {
        name: name.trim(),
        type: project.type,
        canvas: latestCanvas.current ?? editor.doc,
        syncState: "synced",
      });
      setProject(value);
      setDirty(false);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project could not be saved.");
    } finally {
      setSaving(false);
    }
  }, [editor.doc, name, params.id, project]);

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    if (!dirty || loading || saving) return;
    const timer = window.setTimeout(() => void saveRef.current(), 1200);
    return () => window.clearTimeout(timer);
  }, [dirty, loading, name, saving]);

  if (loading) {
    return (
      <div className="flex min-h-[70dvh] flex-col gap-4 p-4">
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="min-h-[32rem] flex-1 rounded-2xl" />
      </div>
    );
  }

  if (!project || !canvasDoc) {
    return (
      <div className="mx-auto max-w-lg rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center" role="alert">
        <p className="text-lg font-bold">This design is unavailable.</p>
        <p className="mt-2 text-sm text-muted-foreground">{error ?? "It may have been removed or archived."}</p>
        <Link className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-muted" href="/design-studio">
          <ArrowLeft className="h-4 w-4" />
          Return to Design Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-background" data-testid="design-editor">
      <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card/95 px-3 py-2.5 shadow-sm backdrop-blur">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Link
            aria-label="Back to Design Studio"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border hover:bg-muted"
            href="/design-studio"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Input
            aria-label="Project name"
            className="h-9 min-w-0 max-w-sm border-0 bg-transparent px-2 text-sm font-black shadow-none focus-visible:ring-1"
            disabled={!canEdit}
            onChange={(event) => {
              setName(event.target.value);
              setDirty(true);
              setSaved(false);
            }}
            value={name}
          />
          <Badge className="hidden capitalize sm:inline-flex" variant="outline">{project.type}</Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button aria-label="Undo" disabled={!canEdit || !editor.canUndo} onClick={editor.undo} size="icon" variant="ghost">
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button aria-label="Redo" disabled={!canEdit || !editor.canRedo} onClick={editor.redo} size="icon" variant="ghost">
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button aria-label="Zoom out" disabled={editor.doc.zoom <= 0.25} onClick={() => editor.setZoom(editor.doc.zoom - 0.1)} size="icon" variant="ghost">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="hidden min-w-12 text-center text-xs font-semibold text-muted-foreground sm:inline">{Math.round(editor.doc.zoom * 100)}%</span>
          <Button aria-label="Zoom in" disabled={editor.doc.zoom >= 2} onClick={() => editor.setZoom(editor.doc.zoom + 0.1)} size="icon" variant="ghost">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button className="ml-1 gap-1.5" disabled={saving || !name.trim()} onClick={() => void save()} size="sm">
            {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            <span className="hidden sm:inline">{saving ? "Saving…" : saved ? "Saved" : dirty ? "Save" : "Saved"}</span>
          </Button>
        </div>
      </header>

      {error ? (
        <div className="mx-3 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      <main className="relative flex min-h-0 flex-1 flex-col" data-testid="design-canvas">
        <FreeformCanvas assets={assets} editor={editor} />
      </main>

      <footer className="sticky bottom-0 z-20 flex items-center justify-between gap-3 border-t border-border bg-card/95 px-3 py-2 backdrop-blur">
        <div className="min-w-0 text-xs text-muted-foreground">
          {editor.selectedNodes.length
            ? `${editor.selectedNodes.length} layer${editor.selectedNodes.length === 1 ? "" : "s"} selected`
            : "Tap a layer to edit it"}
        </div>
        <Button
          className="shrink-0 gap-2"
          onClick={() => window.open(CANVA_CREATE_URL, "_blank", "noopener,noreferrer")}
          size="sm"
          variant="outline"
        >
          <ExternalLink className="h-4 w-4" />
          Canva
        </Button>
      </footer>
    </div>
  );
}
