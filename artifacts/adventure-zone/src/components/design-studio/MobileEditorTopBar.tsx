import {
  ArrowLeft,
  Check,
  Download,
  Redo2,
  RefreshCw,
  Save,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Link } from "wouter";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import type { DesignType } from "@/lib/design-studio-api";

export function MobileEditorTopBar({
  name,
  type,
  canEdit,
  canUndo,
  canRedo,
  zoom,
  saving,
  saved,
  dirty,
  onNameChange,
  onUndo,
  onRedo,
  onZoomChange,
  onSave,
  onExport,
}: {
  name: string;
  type: DesignType;
  canEdit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  saving: boolean;
  saved: boolean;
  dirty: boolean;
  onNameChange: (name: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  onZoomChange: (zoom: number) => void;
  onSave: () => void;
  onExport: () => void;
}) {
  return (
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
          onChange={(event) => onNameChange(event.target.value)}
          value={name}
        />
        <Badge className="hidden capitalize sm:inline-flex" variant="outline">{type}</Badge>
      </div>

      <div className="flex items-center gap-1">
        <Button aria-label="Undo" disabled={!canEdit || !canUndo} onClick={onUndo} size="icon" variant="ghost"><Undo2 className="h-4 w-4" /></Button>
        <Button aria-label="Redo" disabled={!canEdit || !canRedo} onClick={onRedo} size="icon" variant="ghost"><Redo2 className="h-4 w-4" /></Button>
        <Button aria-label="Zoom out" disabled={zoom <= 0.25} onClick={() => onZoomChange(zoom - 0.1)} size="icon" variant="ghost"><ZoomOut className="h-4 w-4" /></Button>
        <span className="hidden min-w-12 text-center text-xs font-semibold text-muted-foreground sm:inline">{Math.round(zoom * 100)}%</span>
        <Button aria-label="Zoom in" disabled={zoom >= 2} onClick={() => onZoomChange(zoom + 0.1)} size="icon" variant="ghost"><ZoomIn className="h-4 w-4" /></Button>
        <Button aria-label="Export design" onClick={onExport} size="icon" variant="ghost"><Download className="h-4 w-4" /></Button>
        <Button className="ml-1 gap-1.5" disabled={saving || !name.trim()} onClick={onSave} size="sm">
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          <span className="hidden sm:inline">{saving ? "Saving…" : saved || !dirty ? "Saved" : "Save"}</span>
        </Button>
      </div>
    </header>
  );
}
