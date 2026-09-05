// Boss variant of the Design Studio editor — uses Boss token via bossDesignStudioApi.
// Structurally mirrors DesignStudioEditorPage but imports from boss-design-studio-api.
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useParams } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { bossDesignStudioApi } from "@/lib/boss-design-studio-api";
import { starterById } from "@/lib/design-studio/canva-starters";
import { createImageNode, normalizeCanvas, type CanvasDocument } from "@/lib/design-studio/model";
import { downloadDesignBlob, exportCanvasPdf, exportCanvasPng } from "@/lib/design-studio/export-canvas";
import { useFreeformEditor } from "@/components/design-studio/use-freeform-editor";
import { FreeformCanvas } from "@/components/design-studio/FreeformCanvas";
import { MobileEditorTopBar } from "@/components/design-studio/MobileEditorTopBar";
import { ContextualBottomToolbar } from "@/components/design-studio/ContextualBottomToolbar";
import { AssetPickerSheet, type PickerAsset } from "@/components/design-studio/AssetPickerSheet";
import { LayersSheet } from "@/components/design-studio/LayersSheet";
import { AddElementSheet } from "@/components/design-studio/AddElementSheet";
import { ExportSheet } from "@/components/design-studio/ExportSheet";
import type { DesignAsset, DesignProject } from "@/lib/design-studio-api";

const STARTER_PREFIX = "CANVA_STARTER_ID=";
const EMPTY_CANVAS = normalizeCanvas(null);

type PhotoPickerMode = "add" | "replace";
type ExportFormat = "png" | "pdf";

function noteValue(notes: string | null | undefined, prefix: string) {
  return (notes ?? "").split("\n").find((line) => line.startsWith(prefix))?.slice(prefix.length) ?? "";
}

function exportFilename(name: string, format: ExportFormat) {
  const stem = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "adventure-zone-design";
  return `${stem}.${format}`;
}

export default function BossDesignStudioEditorPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<DesignProject | null>(null);
  const [name, setName] = useState("");
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument | null>(null);
  const [photoPickerMode, setPhotoPickerMode] = useState<PhotoPickerMode | null>(null);
  const [showLayers, setShowLayers] = useState(false);
  const [showAddElements, setShowAddElements] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestCanvas = useRef<CanvasDocument | null>(null);

  const canEdit = Boolean(project && !["archived", "used", "sent"].includes(project.status ?? ""));

  const onCanvasChange = useCallback((doc: CanvasDocument) => {
    latestCanvas.current = doc;
    setDirty(true);
    setSaved(false);
  }, []);

  const editor = useFreeformEditor(canvasDoc ?? EMPTY_CANVAS, { canEdit, onChange: onCanvasChange });

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);
    Promise.all([
      bossDesignStudioApi.get(params.id),
      bossDesignStudioApi.listAssets().catch(() => [] as DesignAsset[]),
    ]).then(([value, assetList]) => {
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
    }).catch((cause) => {
      setError(cause instanceof Error ? cause.message : "Project could not be loaded.");
    }).finally(() => setLoading(false));
  }, [params.id]);

  const save = useCallback(async () => {
    if (!params.id || !project || !name.trim()) return false;
    setSaving(true);
    setError(null);
    try {
      const value = await bossDesignStudioApi.update(params.id, {
        name: name.trim(),
        type: project.type,
        canvas: latestCanvas.current ?? editor.doc,
        syncState: "synced",
      });
      setProject(value);
      setDirty(false);
      setSaved(true);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project could not be saved.");
      return false;
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

  function choosePhoto(asset: PickerAsset) {
    const common = {
      name: asset.name,
      alt: asset.altText ?? asset.name,
      assetId: asset.builtin ? null : asset.id,
      src: asset.builtin ? asset.url ?? null : null,
    };
    if (photoPickerMode === "replace") {
      editor.patchSelected(common);
    } else {
      editor.insertNode(createImageNode({
        ...common,
        x: Math.max(24, editor.doc.width * 0.18),
        y: Math.max(24, editor.doc.height * 0.18),
        width: Math.min(420, editor.doc.width * 0.52),
        height: Math.min(300, editor.doc.height * 0.32),
      }));
    }
    setPhotoPickerMode(null);
  }

  async function exportDesign(format: ExportFormat) {
    setExporting(format);
    setError(null);
    try {
      const doc = latestCanvas.current ?? editor.doc;
      const blob = format === "png" ? await exportCanvasPng(doc, assets) : await exportCanvasPdf(doc, assets);
      downloadDesignBlob(blob, exportFilename(name, format));
      setShowExport(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not export ${format.toUpperCase()}.`);
    } finally {
      setExporting(null);
    }
  }

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
        <Link className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-muted" href="/boss/design-studio">
          <ArrowLeft className="h-4 w-4" />
          Return to Design Studio
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-background" data-testid="boss-design-editor">
      <MobileEditorTopBar
        canEdit={canEdit}
        canRedo={editor.canRedo}
        canUndo={editor.canUndo}
        dirty={dirty}
        name={name}
        onExport={() => setShowExport(true)}
        onNameChange={(nextName) => { setName(nextName); setDirty(true); setSaved(false); }}
        onRedo={editor.redo}
        onSave={() => void save()}
        onUndo={editor.undo}
        onZoomChange={editor.setZoom}
        saved={saved}
        saving={saving}
        type={project.type}
        zoom={editor.doc.zoom}
      />

      {error ? (
        <div className="mx-3 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</div>
      ) : null}

      <main className="relative flex min-h-0 flex-1 flex-col" data-testid="boss-design-canvas">
        <FreeformCanvas assets={assets} editor={editor} />
      </main>

      <div className="relative z-20">
        <ContextualBottomToolbar
          editor={editor}
          onAddPhoto={() => setPhotoPickerMode("add")}
          onOpenAdd={() => setShowAddElements(true)}
          onOpenLayers={() => setShowLayers(true)}
          onReplacePhoto={() => setPhotoPickerMode("replace")}
        />
        <div className="border-t border-border bg-card px-3 py-2">
          <span className="truncate text-[11px] text-muted-foreground">
            {editor.selectedNodes.length
              ? `${editor.selectedNodes.length} layer${editor.selectedNodes.length === 1 ? "" : "s"} selected`
              : "Tap a layer to edit it"}
          </span>
        </div>
      </div>

      {photoPickerMode ? <AssetPickerSheet assets={assets} onChoose={choosePhoto} onClose={() => setPhotoPickerMode(null)} /> : null}
      {showLayers ? <LayersSheet editor={editor} onClose={() => setShowLayers(false)} /> : null}
      {showAddElements ? <AddElementSheet editor={editor} onClose={() => setShowAddElements(false)} /> : null}
      {showExport ? <ExportSheet exporting={exporting} onClose={() => setShowExport(false)} onExportPdf={() => void exportDesign("pdf")} onExportPng={() => void exportDesign("png")} /> : null}
    </div>
  );
}
