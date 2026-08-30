import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  ChevronsDown,
  ChevronsUp,
  ChevronUp,
  Copy,
  FlipHorizontal,
  FlipVertical,
  Group,
  Italic,
  Lock,
  Trash2,
  Underline,
  Ungroup,
  Unlock,
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
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Separator } from "@workspace/avz-crm/components/ui/separator";
import { Slider } from "@workspace/avz-crm/components/ui/slider";
import { Textarea } from "@workspace/avz-crm/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@workspace/avz-crm/components/ui/toggle-group";
import {
  isImageAsset,
  type DesignAsset,
} from "@/lib/design-studio-api";
import {
  FONT_FAMILIES,
  type CanvasNode,
  type ImageNode,
  type ShapeNode,
  type TextNode,
} from "@/lib/design-studio/model";
import type { FreeformEditor } from "./use-freeform-editor";

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

const SWATCHES: { label: string; value: string }[] = [
  { label: "Primary",     value: "hsl(var(--primary))" },
  { label: "Secondary",   value: "hsl(var(--secondary))" },
  { label: "Accent",      value: "hsl(var(--accent))" },
  { label: "Foreground",  value: "hsl(var(--foreground))" },
  { label: "Muted",       value: "hsl(var(--muted-foreground))" },
  { label: "Destructive", value: "hsl(var(--destructive))" },
  { label: "Card",        value: "hsl(var(--card))" },
  { label: "Border",      value: "hsl(var(--border))" },
];

function Swatches({
  value,
  onSelect,
  testid,
}: {
  value: string;
  onSelect: (v: string) => void;
  testid: string;
}) {
  return (
    <div className="grid grid-cols-8 gap-1.5" data-testid={testid}>
      {SWATCHES.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-label={s.label}
          title={s.label}
          onClick={() => onSelect(s.value)}
          className={`aspect-square rounded-md border transition-transform hover:scale-105 ${
            value === s.value ? "border-primary ring-2 ring-primary/40" : "border-border"
          }`}
          style={{ backgroundColor: s.value }}
        />
      ))}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step = 1,
  testid,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
  testid: string;
}) {
  return (
    <div className="grid gap-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <Input
        type="number"
        className="h-8 text-xs"
        value={step < 1 ? value : Math.round(value)}
        disabled={disabled}
        min={min}
        max={max}
        step={step}
        data-testid={testid}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function InspectorPanel({
  editor,
  assets,
}: {
  editor: FreeformEditor;
  assets: DesignAsset[];
}) {
  const { selectedNodes, selectedIds, canEdit } = editor;
  const single = selectedNodes.length === 1 ? selectedNodes[0]! : null;
  const multi = selectedNodes.length > 1;
  const locked = single?.locked ?? false;
  const disabled = !canEdit || locked;

  if (selectedNodes.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
        <p className="px-4 text-sm text-muted-foreground">
          Select a layer on the canvas to edit its properties. Hold Shift to select more than one.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4" data-testid="inspector-panel">
      {/* Header */}
      <div className="rounded-lg border border-border bg-muted/40 p-3">
        <p className="font-bold leading-tight" data-testid="text-inspector-name">
          {multi ? `${selectedNodes.length} layers selected` : single?.name}
        </p>
        <p className="mt-0.5 text-xs capitalize text-muted-foreground">
          {multi ? "Multiple selection" : `${single?.kind} layer`}
        </p>
      </div>

      {/* Multi-select alignment + group */}
      {multi ? (
        <div className="grid gap-2">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Align</Label>
          <div className="grid grid-cols-3 gap-1.5">
            <Button size="sm" variant="outline" onClick={() => editor.align("left")}     disabled={!canEdit} aria-label="Align left"            data-testid="button-align-left"><AlignLeft className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => editor.align("center-h")} disabled={!canEdit} aria-label="Align centre horizontal" data-testid="button-align-center-h"><AlignCenter className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => editor.align("right")}    disabled={!canEdit} aria-label="Align right"            data-testid="button-align-right"><AlignRight className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="outline" onClick={() => editor.align("top")}      disabled={!canEdit} aria-label="Align top"              data-testid="button-align-top"><AlignLeft className="h-3.5 w-3.5 rotate-90" /></Button>
            <Button size="sm" variant="outline" onClick={() => editor.align("center-v")} disabled={!canEdit} aria-label="Align centre vertical"  data-testid="button-align-center-v"><AlignCenter className="h-3.5 w-3.5 rotate-90" /></Button>
            <Button size="sm" variant="outline" onClick={() => editor.align("bottom")}   disabled={!canEdit} aria-label="Align bottom"           data-testid="button-align-bottom"><AlignRight className="h-3.5 w-3.5 rotate-90" /></Button>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" onClick={editor.group}   disabled={!canEdit} data-testid="button-group">  <Group   className="mr-1 h-3.5 w-3.5" />Group</Button>
            <Button size="sm" variant="outline" onClick={editor.ungroup} disabled={!canEdit} data-testid="button-ungroup"><Ungroup className="mr-1 h-3.5 w-3.5" />Ungroup</Button>
          </div>
        </div>
      ) : null}

      {/* Kind-specific inspector */}
      {single?.kind === "text"  ? <TextInspector  node={single} editor={editor} disabled={disabled} /> : null}
      {single?.kind === "shape" ? <ShapeInspector node={single} editor={editor} disabled={disabled} /> : null}
      {single?.kind === "image" ? <ImageInspector node={single} editor={editor} disabled={disabled} assets={assets} /> : null}

      {/* Position + size (single selection) */}
      {single ? (
        <>
          <Separator />
          <div className="grid gap-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Position &amp; size</Label>
            <div className="grid grid-cols-2 gap-2">
              <NumberField label="X"      value={single.x}      onChange={(v) => editor.patchSelected({ x: v })}                     disabled={disabled} testid="input-pos-x" />
              <NumberField label="Y"      value={single.y}      onChange={(v) => editor.patchSelected({ y: v })}                     disabled={disabled} testid="input-pos-y" />
              <NumberField label="Width"  value={single.width}  onChange={(v) => editor.patchSelected({ width:  Math.max(8, v) })}   disabled={disabled} testid="input-size-w" />
              <NumberField label="Height" value={single.height} onChange={(v) => editor.patchSelected({ height: Math.max(8, v) })}   disabled={disabled} testid="input-size-h" />
            </div>
            <div className="grid gap-1">
              <Label className="text-[11px] text-muted-foreground">Rotation ({Math.round(single.rotation)} deg)</Label>
              <Slider value={[single.rotation]} min={0} max={359} step={1} disabled={disabled} onValueChange={([v]) => editor.patchSelected({ rotation: v })} data-testid="slider-rotation" />
            </div>
          </div>
        </>
      ) : null}

      {/* Opacity */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">
          Opacity ({Math.round((single?.opacity ?? 1) * 100)}%)
        </Label>
        <Slider
          value={[single?.opacity ?? 1]}
          min={0.1}
          max={1}
          step={0.05}
          disabled={!canEdit || (single?.locked ?? false)}
          onValueChange={([v]) => editor.patchSelected({ opacity: v })}
          data-testid="slider-opacity"
        />
      </div>

      <Separator />

      {/* Arrange */}
      <div className="grid gap-2">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Arrange</Label>
        <div className="grid grid-cols-4 gap-1.5">
          <Button size="sm" variant="outline" disabled={!single || !canEdit} onClick={() => single && editor.reorder(single.id, "front")}    aria-label="Bring to front"  data-testid="button-front">   <ChevronsUp   className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" disabled={!single || !canEdit} onClick={() => single && editor.reorder(single.id, "forward")}  aria-label="Bring forward"   data-testid="button-forward"> <ChevronUp    className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" disabled={!single || !canEdit} onClick={() => single && editor.reorder(single.id, "backward")} aria-label="Send backward"   data-testid="button-backward"><ChevronDown  className="h-3.5 w-3.5" /></Button>
          <Button size="sm" variant="outline" disabled={!single || !canEdit} onClick={() => single && editor.reorder(single.id, "back")}     aria-label="Send to back"    data-testid="button-back">    <ChevronsDown className="h-3.5 w-3.5" /></Button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="outline" disabled={!canEdit} onClick={editor.duplicateSelected} data-testid="button-duplicate-node">
            <Copy className="mr-1 h-3.5 w-3.5" />Duplicate
          </Button>
          <Button
            size="sm"
            variant={locked ? "default" : "outline"}
            disabled={!canEdit || multi}
            onClick={() => single && editor.patchNodes([single.id], { locked: !single.locked })}
            data-testid="button-toggle-lock"
          >
            {locked ? <Unlock className="mr-1 h-3.5 w-3.5" /> : <Lock className="mr-1 h-3.5 w-3.5" />}
            {locked ? "Unlock" : "Lock"}
          </Button>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          disabled={!canEdit || locked}
          onClick={editor.removeSelected}
          data-testid="button-delete-node"
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          Delete {selectedIds.length > 1 ? `${selectedIds.length} layers` : "layer"}
        </Button>
      </div>
    </div>
  );
}

// Convenience so each sub-inspector can write one-liner patches.
function patch(editor: FreeformEditor, p: Partial<CanvasNode>) {
  editor.patchSelected(p);
}

// ---------------------------------------------------------------------------
// TextInspector
// ---------------------------------------------------------------------------

function TextInspector({
  node,
  editor,
  disabled,
}: {
  node: TextNode;
  editor: FreeformEditor;
  disabled: boolean;
}) {
  return (
    <div className="grid gap-3" data-testid="inspector-text">
      {/* Content */}
      <div className="grid gap-1.5">
        <Label htmlFor="text-content" className="text-xs font-semibold">Text</Label>
        <Textarea
          id="text-content"
          value={node.text}
          disabled={disabled}
          className="min-h-16 resize-y text-sm"
          data-testid="input-text-content"
          onChange={(e) => patch(editor, { text: e.target.value })}
        />
      </div>

      {/* Font family */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Font</Label>
        <Select
          value={node.fontFamily}
          disabled={disabled}
          onValueChange={(v) => patch(editor, { fontFamily: v as TextNode["fontFamily"] })}
        >
          <SelectTrigger className="h-8 text-xs" data-testid="select-font-family">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FONT_FAMILIES.map((f) => (
              <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Size + weight */}
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Size (px)"
          value={node.fontSize}
          onChange={(v) => patch(editor, { fontSize: Math.max(8, v) })}
          disabled={disabled}
          min={8}
          testid="input-font-size"
        />
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">Weight</Label>
          <ToggleGroup
            type="single"
            value={String(node.fontWeight)}
            disabled={disabled}
            onValueChange={(v) => v && patch(editor, { fontWeight: Number(v) })}
            className="justify-start"
          >
            <ToggleGroupItem value="400" className="h-8 px-2 text-xs" data-testid="toggle-weight-regular">Reg</ToggleGroupItem>
            <ToggleGroupItem value="700" className="h-8 px-2 text-xs" data-testid="toggle-weight-bold">
              <Bold className="h-3.5 w-3.5" />
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>

      {/* Style toggles: italic, underline */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Style</Label>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={node.italic ? "default" : "outline"}
            className="h-8 w-8 p-0"
            disabled={disabled}
            aria-label="Italic"
            aria-pressed={node.italic}
            data-testid="button-italic"
            onClick={() => patch(editor, { italic: !node.italic })}
          >
            <Italic className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant={node.underline ? "default" : "outline"}
            className="h-8 w-8 p-0"
            disabled={disabled}
            aria-label="Underline"
            aria-pressed={node.underline}
            data-testid="button-underline"
            onClick={() => patch(editor, { underline: !node.underline })}
          >
            <Underline className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Letter spacing (stored as em×100) */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">
          Letter spacing ({node.letterSpacing > 0 ? "+" : ""}{node.letterSpacing / 100}em)
        </Label>
        <Slider
          value={[node.letterSpacing]}
          min={-20}
          max={100}
          step={1}
          disabled={disabled}
          onValueChange={([v]) => patch(editor, { letterSpacing: v })}
          data-testid="slider-letter-spacing"
        />
      </div>

      {/* Line height */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">
          Line height ({node.lineHeight.toFixed(1)})
        </Label>
        <Slider
          value={[node.lineHeight]}
          min={0.8}
          max={3}
          step={0.1}
          disabled={disabled}
          onValueChange={([v]) => patch(editor, { lineHeight: Math.round(v * 10) / 10 })}
          data-testid="slider-line-height"
        />
      </div>

      {/* Text alignment */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Alignment</Label>
        <ToggleGroup
          type="single"
          value={node.align}
          disabled={disabled}
          onValueChange={(v) => v && patch(editor, { align: v as TextNode["align"] })}
          className="justify-start"
        >
          <ToggleGroupItem value="left"   className="h-8 px-2" aria-label="Align left"   data-testid="toggle-align-left">  <AlignLeft   className="h-3.5 w-3.5" /></ToggleGroupItem>
          <ToggleGroupItem value="center" className="h-8 px-2" aria-label="Align centre" data-testid="toggle-align-center"><AlignCenter className="h-3.5 w-3.5" /></ToggleGroupItem>
          <ToggleGroupItem value="right"  className="h-8 px-2" aria-label="Align right"  data-testid="toggle-align-right"> <AlignRight  className="h-3.5 w-3.5" /></ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Color */}
      <div className="grid gap-1.5">
        <Label className="text-xs font-semibold">Color</Label>
        <Swatches value={node.color} onSelect={(v) => patch(editor, { color: v })} testid="swatches-text-color" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ShapeInspector
// ---------------------------------------------------------------------------

function ShapeInspector({
  node,
  editor,
  disabled,
}: {
  node: ShapeNode;
  editor: FreeformEditor;
  disabled: boolean;
}) {
  const isLine = node.variant === "line" || node.variant === "arrow";
  const supportsRadius = node.variant === "rectangle";

  return (
    <div className="grid gap-3" data-testid="inspector-shape">
      {/* Fill (not for lines) */}
      {!isLine ? (
        <div className="grid gap-1.5">
          <Label className="text-xs font-semibold">Fill</Label>
          <Swatches value={node.fill} onSelect={(v) => patch(editor, { fill: v })} testid="swatches-shape-fill" />
        </div>
      ) : null}

      {/* Stroke / line colour */}
      <div className="grid gap-1.5">
        <Label className="text-xs font-semibold">{isLine ? "Line colour" : "Stroke"}</Label>
        <Swatches value={node.stroke} onSelect={(v) => patch(editor, { stroke: v })} testid="swatches-shape-stroke" />
      </div>

      {/* Stroke width */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Stroke width ({node.strokeWidth}px)</Label>
        <Slider
          value={[node.strokeWidth]}
          min={0}
          max={20}
          step={1}
          disabled={disabled}
          onValueChange={([v]) => patch(editor, { strokeWidth: v })}
          data-testid="slider-stroke-width"
        />
      </div>

      {/* Corner radius (rectangle only) */}
      {supportsRadius ? (
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">Corner radius ({node.cornerRadius}px)</Label>
          <Slider
            value={[node.cornerRadius]}
            min={0}
            max={120}
            step={1}
            disabled={disabled}
            onValueChange={([v]) => patch(editor, { cornerRadius: v })}
            data-testid="slider-corner-radius"
          />
        </div>
      ) : null}

      {/* Flip controls */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Flip</Label>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={node.flipX ? "default" : "outline"}
            className="h-8 gap-1.5 text-xs"
            disabled={disabled}
            aria-label="Flip horizontal"
            aria-pressed={node.flipX}
            data-testid="button-shape-flip-x"
            onClick={() => patch(editor, { flipX: !node.flipX })}
          >
            <FlipHorizontal className="h-3.5 w-3.5" />H
          </Button>
          <Button
            size="sm"
            variant={node.flipY ? "default" : "outline"}
            className="h-8 gap-1.5 text-xs"
            disabled={disabled}
            aria-label="Flip vertical"
            aria-pressed={node.flipY}
            data-testid="button-shape-flip-y"
            onClick={() => patch(editor, { flipY: !node.flipY })}
          >
            <FlipVertical className="h-3.5 w-3.5" />V
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ImageInspector
// ---------------------------------------------------------------------------

function ImageInspector({
  node,
  editor,
  disabled,
  assets,
}: {
  node: ImageNode;
  editor: FreeformEditor;
  disabled: boolean;
  assets: DesignAsset[];
}) {
  const imageAssets = assets.filter(isImageAsset);

  return (
    <div className="grid gap-3" data-testid="inspector-image">
      {/* Asset replacement */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Replace image</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              className="justify-between text-xs"
              data-testid="button-replace-image"
            >
              {node.assetId
                ? (imageAssets.find((a) => a.id === node.assetId)?.name ?? "Current asset")
                : "Placeholder"}
              <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-60 w-56 overflow-y-auto">
            <DropdownMenuLabel>Studio assets</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {imageAssets.length > 0 ? (
              imageAssets.map((asset) => (
                <DropdownMenuItem
                  key={asset.id}
                  data-testid={`menu-replace-asset-${asset.id}`}
                  onClick={() =>
                    // Store only assetId; never bake a signed URL into src.
                    patch(editor, {
                      src: null,
                      assetId: asset.id,
                      alt: asset.altText ?? asset.name,
                    })
                  }
                >
                  <span className="truncate">{asset.name}</span>
                  <span className="ml-auto text-[10px] capitalize text-muted-foreground">{asset.scope}</span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>No image assets available</DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              data-testid="menu-replace-placeholder"
              onClick={() => patch(editor, { src: null, assetId: null })}
            >
              Use placeholder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Alt text */}
      <div className="grid gap-1.5">
        <Label htmlFor="image-alt" className="text-xs font-semibold">Alt text</Label>
        <Input
          id="image-alt"
          value={node.alt}
          disabled={disabled}
          className="h-8 text-sm"
          data-testid="input-image-alt"
          onChange={(e) => patch(editor, { alt: e.target.value })}
        />
      </div>

      {/* Fit */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Fit</Label>
        <ToggleGroup
          type="single"
          value={node.fit}
          disabled={disabled}
          onValueChange={(v) => v && patch(editor, { fit: v as ImageNode["fit"] })}
          className="justify-start"
        >
          <ToggleGroupItem value="cover"   className="h-8 px-3 text-xs" data-testid="toggle-fit-cover">Cover</ToggleGroupItem>
          <ToggleGroupItem value="contain" className="h-8 px-3 text-xs" data-testid="toggle-fit-contain">Contain</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Object position — crop focus point */}
      <div className="grid gap-2">
        <Label className="text-[11px] text-muted-foreground">Crop position</Label>
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">X ({node.objectPositionX}%)</Label>
          <Slider
            value={[node.objectPositionX]}
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            onValueChange={([v]) => patch(editor, { objectPositionX: v })}
            data-testid="slider-obj-pos-x"
          />
        </div>
        <div className="grid gap-1">
          <Label className="text-[11px] text-muted-foreground">Y ({node.objectPositionY}%)</Label>
          <Slider
            value={[node.objectPositionY]}
            min={0}
            max={100}
            step={1}
            disabled={disabled}
            onValueChange={([v]) => patch(editor, { objectPositionY: v })}
            data-testid="slider-obj-pos-y"
          />
        </div>
      </div>

      {/* Flip controls */}
      <div className="grid gap-1">
        <Label className="text-[11px] text-muted-foreground">Flip</Label>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant={node.flipX ? "default" : "outline"}
            className="h-8 gap-1.5 text-xs"
            disabled={disabled}
            aria-label="Flip horizontal"
            aria-pressed={node.flipX}
            data-testid="button-image-flip-x"
            onClick={() => patch(editor, { flipX: !node.flipX })}
          >
            <FlipHorizontal className="h-3.5 w-3.5" />H
          </Button>
          <Button
            size="sm"
            variant={node.flipY ? "default" : "outline"}
            className="h-8 gap-1.5 text-xs"
            disabled={disabled}
            aria-label="Flip vertical"
            aria-pressed={node.flipY}
            data-testid="button-image-flip-y"
            onClick={() => patch(editor, { flipY: !node.flipY })}
          >
            <FlipVertical className="h-3.5 w-3.5" />V
          </Button>
        </div>
      </div>
    </div>
  );
}
