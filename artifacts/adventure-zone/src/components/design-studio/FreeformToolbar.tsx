import {
  ArrowRight,
  Circle,
  Grid3x3,
  Image as ImageIcon,
  Minus,
  Redo2,
  Square,
  Star,
  Triangle,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/avz-crm/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/avz-crm/components/ui/tooltip";
import {
  isImageAsset,
  type DesignAsset,
} from "@/lib/design-studio-api";
import {
  createImageNode,
  createShapeNode,
  createTextNode,
  type ShapeVariant,
} from "@/lib/design-studio/model";
import type { FreeformEditor } from "./use-freeform-editor";

const SHAPES: { variant: ShapeVariant; label: string; icon: typeof Square }[] = [
  { variant: "rectangle", label: "Rectangle", icon: Square },
  { variant: "circle", label: "Circle", icon: Circle },
  { variant: "triangle", label: "Triangle", icon: Triangle },
  { variant: "star", label: "Star", icon: Star },
  { variant: "line", label: "Line", icon: Minus },
  { variant: "arrow", label: "Arrow", icon: ArrowRight },
];

export function FreeformToolbar({
  editor,
  assets,
}: {
  editor: FreeformEditor;
  assets: DesignAsset[];
}) {
  const { canEdit, doc } = editor;
  const imageAssets = assets.filter(isImageAsset);

  const addShape = (variant: ShapeVariant) =>
    editor.insertNode(createShapeNode(variant));

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="freeform-toolbar">
      {/* Add text */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button size="sm" variant="outline" disabled={!canEdit} onClick={() => editor.insertNode(createTextNode())} data-testid="button-add-text">
            <Type className="mr-1.5 h-4 w-4" />Text
          </Button>
        </TooltipTrigger>
        <TooltipContent>Add a text layer</TooltipContent>
      </Tooltip>

      {/* Shapes menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={!canEdit} data-testid="button-add-shape">
            <Square className="mr-1.5 h-4 w-4" />Shape
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Add shape</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {SHAPES.map(({ variant, label, icon: Icon }) => (
            <DropdownMenuItem key={variant} onClick={() => addShape(variant)} data-testid={`menu-shape-${variant}`}>
              <Icon className="mr-2 h-4 w-4" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Image / asset menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" disabled={!canEdit} data-testid="button-add-image">
            <ImageIcon className="mr-1.5 h-4 w-4" />Image
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
          <DropdownMenuLabel>Studio assets</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {imageAssets.length > 0 ? (
            imageAssets.map((asset) => (
              <DropdownMenuItem
                key={asset.id}
                data-testid={`menu-asset-${asset.id}`}
                onClick={() =>
                  editor.insertNode(
                    // Persist only the assetId; the (possibly signed) URL is
                    // resolved at render time from the loaded asset list.
                    createImageNode({
                      src: null,
                      assetId: asset.id,
                      name: asset.name,
                      alt: asset.altText ?? asset.name,
                    }),
                  )
                }
              >
                <span className="truncate">{asset.name}</span>
                <span className="ml-auto text-[10px] capitalize text-muted-foreground">{asset.scope}</span>
              </DropdownMenuItem>
            ))
          ) : (
            <DropdownMenuItem disabled>No image assets in the Brand Library</DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => editor.insertNode(createImageNode())} data-testid="menu-image-placeholder">
            <ImageIcon className="mr-2 h-4 w-4" />
            Image placeholder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

      {/* Undo / redo */}
      <Button size="sm" variant="ghost" disabled={!editor.canUndo} onClick={editor.undo} aria-label="Undo" data-testid="button-undo">
        <Undo2 className="h-4 w-4" />
      </Button>
      <Button size="sm" variant="ghost" disabled={!editor.canRedo} onClick={editor.redo} aria-label="Redo" data-testid="button-redo">
        <Redo2 className="h-4 w-4" />
      </Button>

      <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />

      {/* Grid toggle */}
      <Button
        size="sm"
        variant={doc.showGrid ? "default" : "ghost"}
        onClick={editor.toggleGrid}
        aria-label="Toggle grid"
        aria-pressed={doc.showGrid}
        data-testid="button-toggle-grid"
      >
        <Grid3x3 className="h-4 w-4" />
      </Button>

      {/* Zoom */}
      <div className="ml-auto flex items-center gap-1">
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => editor.setZoom(doc.zoom - 0.1)} aria-label="Zoom out" data-testid="button-zoom-out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="w-10 text-center text-xs tabular-nums text-muted-foreground" data-testid="text-zoom-level">
          {Math.round(doc.zoom * 100)}%
        </span>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => editor.setZoom(doc.zoom + 0.1)} aria-label="Zoom in" data-testid="button-zoom-in">
          <ZoomIn className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
