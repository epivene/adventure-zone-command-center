import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ExternalLink, RefreshCw } from "lucide-react";
import { Link, useParams } from "wouter";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  designStudioApi,
  type CanvaProjectState,
  type DesignAsset,
  type DesignProject,
} from "@/lib/design-studio-api";
import { starterById } from "@/lib/design-studio/canva-starters";
import {
  createImageNode,
  normalizeCanvas,
  type CanvasDocument,
} from "@/lib/design-studio/model";
import {
  downloadDesignBlob,
  exportCanvasPdf,
  exportCanvasPng,
} from "@/lib/design-studio/export-canvas";
import { useFreeformEditor } from "@/components/design-studio/use-freeform-editor";
import { FreeformCanvas } from "@/components/design-studio/FreeformCanvas";
import { MobileEditorTopBar } from "@/components/design-studio/MobileEditorTopBar";
import { ContextualBottomToolbar } from "@/components/design-studio/ContextualBottomToolbar";
import {
  AssetPickerSheet,
  type PickerAsset,
} from "@/components/design-studio/AssetPickerSheet";
import { LayersSheet } from "@/components/design-studio/LayersSheet";
import { AddElementSheet } from "@/components/design-studio/AddElementSheet";
import { ExportSheet } from "@/components/design-studio/ExportSheet";
import { CanvaHandoffSheet } from "@/components/design-studio/CanvaHandoffSheet";
import { ContractSignaturePanel } from "@/components/design-studio/ContractSignaturePanel";
import { BrandedEmailEditor } from "@/components/design-studio/BrandedEmailEditor";
import { BrandedVisualEditor } from "@/components/design-studio/BrandedVisualEditor";
import { shouldAcknowledgeSave } from "@/lib/design-studio/email-model";

const STARTER_PREFIX = "CANVA_STARTER_ID=";
const EMPTY_CANVAS = normalizeCanvas(null);

type PhotoPickerMode = "add" | "replace";
type ExportFormat = "png" | "pdf";

function noteValue(notes: string | null | undefined, prefix: string) {
  return (notes ?? "")
    .split("\n")
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function exportFilename(name: string, format: ExportFormat) {
  const stem = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "adventure-zone-design";
  return `${stem}.${format}`;
}

function canvaButtonLabel(state: CanvaProjectState | null, dirty: boolean) {
  if (!state) return "Canva";
  if (!state.configured) return "Canva setup needed";
  if (!state.connected) return "Connect Canva";
  if (state.linked && (state.outdated || dirty)) return "Update Canva";
  if (state.linked) return "Continue in Canva";
  return "Open in Canva";
}

function openWaitingWindow() {
  const target = window.open("about:blank", "_blank");
  if (target) {
    try { target.opener = null; } catch { /* browser may forbid changing opener */ }
  }
  return target;
}

function navigateCanvaWindow(target: Window | null, url: string) {
  if (target && !target.closed) {
    target.location.replace(url);
    return;
  }
  window.location.assign(url);
}

export default function DesignStudioEditorPage() {
  const params = useParams<{ id: string }>();
  const [project, setProject] = useState<DesignProject | null>(null);
  const [name, setName] = useState("");
  const [assets, setAssets] = useState<DesignAsset[]>([]);
  const [canvasDoc, setCanvasDoc] = useState<CanvasDocument | null>(null);
  const [canvaState, setCanvaState] = useState<CanvaProjectState | null>(null);
  const [canvaBusy, setCanvaBusy] = useState(false);
  const [showCanvaHandoff, setShowCanvaHandoff] = useState(false);
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
  const editRevision = useRef(0);

  const canEdit = Boolean(
    project &&
      project.status !== "archived" &&
      project.status !== "used" &&
      project.status !== "sent",
  );

  const onCanvasChange = useCallback((doc: CanvasDocument) => {
    latestCanvas.current = doc;
    editRevision.current += 1;
    setDirty(true);
    setSaved(false);
  }, []);

  const editor = useFreeformEditor(canvasDoc ?? EMPTY_CANVAS, {
    canEdit,
    onChange: onCanvasChange,
  });

  const refreshCanvaState = useCallback(async () => {
    if (!params.id) return null;
    try {
      const state = await designStudioApi.getCanvaState(params.id);
      setCanvaState(state);
      return state;
    } catch {
      setCanvaState(null);
      return null;
    }
  }, [params.id]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const canvaError = query.get("canvaError");
    const connected = query.get("canvaConnected");
    if (!canvaError && !connected) return;
    if (canvaError) setError(`Canva connection failed: ${canvaError.replaceAll("_", " ").toLowerCase()}`);
    query.delete("canvaError");
    query.delete("canvaConnected");
    const next = `${window.location.pathname}${query.size ? `?${query.toString()}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", next);
  }, []);

  useEffect(() => {
    if (!params.id) return;
    setLoading(true);
    setError(null);

    Promise.all([
      designStudioApi.get(params.id),
      designStudioApi.listAssets().catch(() => [] as DesignAsset[]),
      designStudioApi.getCanvaState(params.id).catch(() => null),
    ])
      .then(([value, assetList, loadedCanvaState]) => {
        setProject(value);
        setName(value.name);
        setAssets(assetList);
        setCanvaState(loadedCanvaState);

        const starterId = noteValue(value.notes, STARTER_PREFIX);
        const starterCanvas = starterById(starterId)?.canvas ?? null;
        const doc = normalizeCanvas(value.canvas ?? starterCanvas);
        latestCanvas.current = doc;
        editRevision.current = 0;
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
    if (!params.id || !project || !name.trim()) return false;

    const savedRevision = editRevision.current;
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
      if (shouldAcknowledgeSave(savedRevision, editRevision.current)) {
        setDirty(false);
        setSaved(true);
      }
      void refreshCanvaState();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Project could not be saved.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [editor.doc, name, params.id, project, refreshCanvaState]);

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
      const blob = format === "png"
        ? await exportCanvasPng(doc, assets)
        : await exportCanvasPdf(doc, assets);
      downloadDesignBlob(blob, exportFilename(name, format));
      setShowExport(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not export ${format.toUpperCase()}.`);
    } finally {
      setExporting(null);
    }
  }

  async function connectCanva() {
    if (!project) return;
    setCanvaBusy(true);
    setError(null);
    try {
      const started = await designStudioApi.startCanvaConnect(`/design-studio/${project.id}`);
      window.location.assign(started.authorizationUrl);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the Canva connection.");
      setCanvaBusy(false);
    }
  }

  async function openExistingCanva() {
    if (!project) return;
    const target = openWaitingWindow();
    setCanvaBusy(true);
    setError(null);
    try {
      const result = await designStudioApi.getCanvaEditUrl(project.id);
      setShowCanvaHandoff(false);
      navigateCanvaWindow(target, result.editUrl);
    } catch (cause) {
      target?.close();
      setError(cause instanceof Error ? cause.message : "Could not open the Canva design.");
    } finally {
      setCanvaBusy(false);
    }
  }

  async function createCanvaCopy() {
    if (!project) return;
    const target = openWaitingWindow();
    setCanvaBusy(true);
    setError(null);
    try {
      if (dirty) {
        const savedOkay = await save();
        if (!savedOkay) {
          target?.close();
          return;
        }
      }
      const pdf = await exportCanvasPdf(latestCanvas.current ?? editor.doc, assets);
      const imported = await designStudioApi.importToCanva(project.id, pdf);
      await refreshCanvaState();
      setShowCanvaHandoff(false);
      navigateCanvaWindow(target, imported.editUrl);
    } catch (cause) {
      target?.close();
      setError(cause instanceof Error ? cause.message : "Could not create the Canva copy.");
    } finally {
      setCanvaBusy(false);
    }
  }

  function handleCanvaAction() {
    if (!canvaState?.configured) {
      setError("Canva Connect still needs server configuration before it can be used.");
      return;
    }
    if (!canvaState.connected) {
      void connectCanva();
      return;
    }
    if (!canvaState.linked) {
      void createCanvaCopy();
      return;
    }
    if (canvaState.outdated || dirty) {
      setShowCanvaHandoff(true);
      return;
    }
    void openExistingCanva();
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
        <Link className="mt-5 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-primary hover:bg-muted" href="/design-studio">
          <ArrowLeft className="h-4 w-4" />
          Return to Design Studio
        </Link>
      </div>
    );
  }

  if (project.type === "email") {
    return (
      <BrandedEmailEditor
        assets={assets}
        onProjectChange={setProject}
        project={project}
      />
    );
  }

  if (project.type === "flyer" || project.type === "social post" || project.type === "brochure" || project.type === "review request" || project.type === "blank") {
    return (
      <BrandedVisualEditor
        assets={assets}
        canvas={canvasDoc}
        canvaBusy={canvaBusy}
        canvaLabel={canvaButtonLabel(canvaState, dirty)}
        onCanvaAction={handleCanvaAction}
        onProjectChange={setProject}
        project={project}
      />
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-4rem)] flex-col overflow-hidden bg-background" data-testid="design-editor">
      <MobileEditorTopBar
        canEdit={canEdit}
        canRedo={editor.canRedo}
        canUndo={editor.canUndo}
        dirty={dirty}
        name={name}
        onExport={() => setShowExport(true)}
        onNameChange={(nextName) => {
          setName(nextName);
          editRevision.current += 1;
          setDirty(true);
          setSaved(false);
        }}
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
        <div className="mx-3 mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {project.type === "contract" ? (
        <ContractSignaturePanel dirty={dirty} onSave={save} projectId={project.id} />
      ) : null}

      <main className="relative flex min-h-0 flex-1 flex-col" data-testid="design-canvas">
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
        <div className="flex items-center justify-between gap-3 border-t border-border bg-card px-3 py-1.5">
          <span className="truncate text-[11px] text-muted-foreground">
            {editor.selectedNodes.length
              ? `${editor.selectedNodes.length} layer${editor.selectedNodes.length === 1 ? "" : "s"} selected`
              : canvaState?.linked && (canvaState.outdated || dirty)
                ? "Canva copy is older than this design"
                : "Tap a layer to edit it"}
          </span>
          <Button
            className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
            disabled={canvaBusy || saving}
            onClick={handleCanvaAction}
            size="sm"
            variant={canvaState?.linked && !canvaState.outdated && !dirty ? "outline" : "default"}
          >
            {canvaBusy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
            {canvaButtonLabel(canvaState, dirty)}
          </Button>
        </div>
      </div>

      {photoPickerMode ? (
        <AssetPickerSheet
          assets={assets}
          onChoose={choosePhoto}
          onClose={() => setPhotoPickerMode(null)}
        />
      ) : null}

      {showLayers ? (
        <LayersSheet editor={editor} onClose={() => setShowLayers(false)} />
      ) : null}

      {showAddElements ? (
        <AddElementSheet editor={editor} onClose={() => setShowAddElements(false)} />
      ) : null}

      {showExport ? (
        <ExportSheet
          exporting={exporting}
          onClose={() => setShowExport(false)}
          onExportPdf={() => void exportDesign("pdf")}
          onExportPng={() => void exportDesign("png")}
        />
      ) : null}

      {showCanvaHandoff ? (
        <CanvaHandoffSheet
          busy={canvaBusy}
          onClose={() => setShowCanvaHandoff(false)}
          onCreateNewCopy={() => void createCanvaCopy()}
          onOpenExisting={() => void openExistingCanva()}
        />
      ) : null}
    </div>
  );
}
