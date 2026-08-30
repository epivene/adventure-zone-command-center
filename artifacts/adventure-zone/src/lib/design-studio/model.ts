// Versioned, backward-compatible canvas model for the freeform Design Studio.
//
// The model is intentionally a plain serializable structure so it can be saved
// to `DesignProject.canvas` (a JSON column) and re-read across versions. When a
// stored canvas predates the current schema, `normalizeCanvas` upgrades it in
// place, tolerating the legacy percentage-based shape used by the original
// structured editor. All new fields carry safe defaults so every old document
// opens cleanly without a migration step.

export const CANVAS_MODEL_VERSION = 2 as const;

/** Absolute canvas dimensions in logical pixels. */
export const DEFAULT_CANVAS_WIDTH = 960;
export const DEFAULT_CANVAS_HEIGHT = 720;

export type ShapeVariant =
  | "rectangle"
  | "circle"
  | "line"
  | "arrow"
  | "triangle"
  | "star";

export type NodeKind = "text" | "image" | "shape";

/** Fields shared by every node on the canvas. */
export type BaseNode = {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
  /** Group membership; nodes with the same non-null groupId move together. */
  groupId: string | null;
};

export const FONT_FAMILIES = [
  "sans-serif",
  "serif",
  "monospace",
  "Georgia",
  "Trebuchet MS",
  "Impact",
] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export type TextNode = BaseNode & {
  kind: "text";
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  fontFamily: FontFamily;
  italic: boolean;
  underline: boolean;
  letterSpacing: number; // em units × 100 for integer storage, e.g. 0 = normal
  lineHeight: number;    // unitless multiplier, e.g. 1.2
  align: "left" | "center" | "right";
};

export type ShapeNode = BaseNode & {
  kind: "shape";
  variant: ShapeVariant;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** Corner radius in px; only meaningful for rectangles. */
  cornerRadius: number;
  /** Mirror the shape horizontally. */
  flipX: boolean;
  /** Mirror the shape vertically. */
  flipY: boolean;
};

export type ImageNode = BaseNode & {
  kind: "image";
  /** Resolved URL for a real Studio asset, or null for a placeholder. */
  src: string | null;
  assetId: string | null;
  alt: string;
  fit: "cover" | "contain";
  /** CSS object-position X percentage (0–100). */
  objectPositionX: number;
  /** CSS object-position Y percentage (0–100). */
  objectPositionY: number;
  /** Mirror the image horizontally. */
  flipX: boolean;
  /** Mirror the image vertically. */
  flipY: boolean;
};

export type CanvasNode = TextNode | ShapeNode | ImageNode;

export type CanvasPage = {
  id: string;
  name: string;
  background: string;
  nodes: CanvasNode[];
};

export type CanvasDocument = {
  version: number;
  width: number;
  height: number;
  showGrid: boolean;
  gridSize: number;
  /** View zoom factor (1 == 100%). View-only; not persisted to undo history. */
  zoom: number;
  activePageId: string;
  pages: CanvasPage[];
};

export const DEFAULT_TEXT_COLOR = "hsl(var(--foreground))";
export const DEFAULT_SHAPE_FILL = "hsl(var(--primary))";
export const DEFAULT_SHAPE_STROKE = "hsl(var(--border))";
export const DEFAULT_PAGE_BACKGROUND = "hsl(var(--card))";
export const DEFAULT_FONT_FAMILY: FontFamily = "sans-serif";
export const DEFAULT_LINE_HEIGHT = 1.2;
export const DEFAULT_LETTER_SPACING = 0;

let idCounter = 0;
/** Deterministic-ish unique id; time + counter keeps ids stable within a run. */
export function createId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

// --- Internal coercion helpers -------------------------------------------

function clampOpacity(value: unknown): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : 1;
  return Math.min(1, Math.max(0, n));
}

function num(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = num(value, fallback);
  return Math.min(max, Math.max(min, n));
}

// --- Node factories -------------------------------------------------------

export function createTextNode(overrides: Partial<TextNode> = {}): TextNode {
  return {
    id: createId("text"),
    kind: "text",
    name: "Text",
    x: 120,
    y: 120,
    width: 320,
    height: 80,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
    text: "Your next adventure starts here",
    color: DEFAULT_TEXT_COLOR,
    fontSize: 32,
    fontWeight: 700,
    fontFamily: DEFAULT_FONT_FAMILY,
    italic: false,
    underline: false,
    letterSpacing: DEFAULT_LETTER_SPACING,
    lineHeight: DEFAULT_LINE_HEIGHT,
    align: "left",
    ...overrides,
  };
}

export function createShapeNode(
  variant: ShapeVariant,
  overrides: Partial<ShapeNode> = {},
): ShapeNode {
  const isLine = variant === "line" || variant === "arrow";
  return {
    id: createId("shape"),
    kind: "shape",
    name: variant[0]!.toUpperCase() + variant.slice(1),
    x: 160,
    y: 160,
    width: isLine ? 260 : 180,
    height: isLine ? 4 : 140,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
    variant,
    fill: DEFAULT_SHAPE_FILL,
    stroke: DEFAULT_SHAPE_STROKE,
    strokeWidth: isLine ? 4 : 0,
    cornerRadius: 0,
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

export function createImageNode(overrides: Partial<ImageNode> = {}): ImageNode {
  return {
    id: createId("image"),
    kind: "image",
    name: "Image",
    x: 180,
    y: 180,
    width: 260,
    height: 200,
    rotation: 0,
    opacity: 1,
    locked: false,
    hidden: false,
    groupId: null,
    src: null,
    assetId: null,
    alt: "Brand image",
    fit: "cover",
    objectPositionX: 50,
    objectPositionY: 50,
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

export function createEmptyPage(name = "Page 1"): CanvasPage {
  return {
    id: createId("page"),
    name,
    background: DEFAULT_PAGE_BACKGROUND,
    nodes: [],
  };
}

export function createDefaultCanvas(): CanvasDocument {
  const page = createEmptyPage();
  page.nodes.push(createTextNode({ x: 120, y: 120 }));
  return {
    version: CANVAS_MODEL_VERSION,
    width: DEFAULT_CANVAS_WIDTH,
    height: DEFAULT_CANVAS_HEIGHT,
    showGrid: false,
    gridSize: 16,
    zoom: 1,
    activePageId: page.id,
    pages: [page],
  };
}

// --- Normalization / migration -------------------------------------------

const VALID_FONT_FAMILIES = new Set<string>(FONT_FAMILIES);
const SIGNED_IMAGE_QUERY = /[?&](x-goog-|x-amz-|signature=|expires=|token=|se=|sig=)/i;

function persistableImageSource(value: unknown, assetId: string | null): string | null {
  if (assetId || typeof value !== "string") return null;
  if (SIGNED_IMAGE_QUERY.test(value)) return null;
  return /^(https?:\/\/|\/|data:)/i.test(value) ? value : null;
}

function normalizeFontFamily(value: unknown): FontFamily {
  return typeof value === "string" && VALID_FONT_FAMILIES.has(value)
    ? (value as FontFamily)
    : DEFAULT_FONT_FAMILY;
}

/**
 * Normalize a text node, forward-porting every new field (fontFamily, italic,
 * underline, letterSpacing, lineHeight) from stored or legacy data. Missing
 * fields receive safe defaults so old documents open cleanly.
 */
function normalizeTextNode(raw: Record<string, unknown>, base: BaseNode): TextNode {
  return {
    ...base,
    kind: "text",
    text: str(raw.text, "Text"),
    color: str(raw.color, DEFAULT_TEXT_COLOR),
    fontSize: clampNum(raw.fontSize, 8, 999, 28),
    fontWeight: num(raw.fontWeight, 700),
    fontFamily: normalizeFontFamily(raw.fontFamily),
    italic: bool(raw.italic, false),
    underline: bool(raw.underline, false),
    letterSpacing: num(raw.letterSpacing, DEFAULT_LETTER_SPACING),
    lineHeight: clampNum(raw.lineHeight, 0.5, 5, DEFAULT_LINE_HEIGHT),
    align: (["left", "center", "right"] as const).includes(raw.align as never)
      ? (raw.align as TextNode["align"])
      : "left",
  };
}

function normalizeShapeNode(raw: Record<string, unknown>, base: BaseNode): ShapeNode {
  const variant: ShapeVariant = (
    ["rectangle", "circle", "line", "arrow", "triangle", "star"] as const
  ).includes(raw.variant as never)
    ? (raw.variant as ShapeVariant)
    : "rectangle";
  return {
    ...base,
    kind: "shape",
    variant,
    fill: str(raw.fill ?? raw.color, DEFAULT_SHAPE_FILL),
    stroke: str(raw.stroke, DEFAULT_SHAPE_STROKE),
    strokeWidth: num(raw.strokeWidth, variant === "line" || variant === "arrow" ? 4 : 0),
    cornerRadius: clampNum(raw.cornerRadius, 0, 500, 0),
    flipX: bool(raw.flipX, false),
    flipY: bool(raw.flipY, false),
  };
}

function normalizeImageNode(raw: Record<string, unknown>, base: BaseNode): ImageNode {
  const assetId = typeof raw.assetId === "string" ? raw.assetId : null;
  return {
    ...base,
    kind: "image",
    src: persistableImageSource(raw.src, assetId),
    assetId,
    alt: str(raw.alt ?? raw.label, "Brand image"),
    fit: raw.fit === "contain" ? "contain" : "cover",
    objectPositionX: clampNum(raw.objectPositionX, 0, 100, 50),
    objectPositionY: clampNum(raw.objectPositionY, 0, 100, 50),
    flipX: bool(raw.flipX, false),
    flipY: bool(raw.flipY, false),
  };
}

/**
 * Convert a raw stored node to a current-schema node.
 *
 * `legacy` is decided once, at the document level, by `normalizeCanvas`: a
 * document is legacy only when it is unambiguously the old structured-editor
 * shape (it carries `elements` arrays and/or has no `version` >= current). Only
 * then are percentage-based (0-100) coordinates rescaled to absolute pixels.
 * A current v2 document is NEVER rescaled, even if a node happens to sit at
 * coordinates <= 100, which previously corrupted small/near-origin nodes.
 */
function normalizeNode(
  raw: Record<string, unknown>,
  width: number,
  height: number,
  legacy: boolean,
): CanvasNode {
  const kind = str(raw.kind, "shape") as NodeKind;
  // Only legacy documents may use percentage coordinates. Within a legacy
  // document, a node is treated as percentage-based only when every coordinate
  // is within the 0-100 range (older data always was).
  const looksPercentage =
    legacy &&
    num(raw.width, 0) <= 100 &&
    num(raw.height, 0) <= 100 &&
    num(raw.x, 0) <= 100 &&
    num(raw.y, 0) <= 100;
  const scaleX = looksPercentage ? width / 100 : 1;
  const scaleY = looksPercentage ? height / 100 : 1;
  const base: BaseNode = {
    id: str(raw.id, createId(kind)),
    kind,
    name: str(raw.label ?? raw.name, kind === "text" ? "Text" : "Layer"),
    x: num(raw.x, 40) * scaleX,
    y: num(raw.y, 40) * scaleY,
    width: num(raw.width, 40) * scaleX,
    height: num(raw.height, 20) * scaleY,
    rotation: num(raw.rotation, 0),
    opacity: clampOpacity(raw.opacity),
    locked: bool(raw.locked, false),
    hidden: bool(raw.hidden, false),
    groupId: typeof raw.groupId === "string" ? raw.groupId : null,
  };
  if (kind === "text") return normalizeTextNode(raw, base);
  if (kind === "image") return normalizeImageNode(raw, base);
  return normalizeShapeNode(raw, base);
}

function normalizePage(
  raw: Record<string, unknown>,
  index: number,
  width: number,
  height: number,
  legacy: boolean,
): CanvasPage {
  const rawNodes = Array.isArray(raw.nodes)
    ? raw.nodes
    : Array.isArray(raw.elements)
      ? raw.elements
      : [];
  return {
    id: str(raw.id, createId("page")),
    name: str(raw.name, `Page ${index + 1}`),
    background: str(raw.background, DEFAULT_PAGE_BACKGROUND),
    nodes: rawNodes
      .filter((n): n is Record<string, unknown> => typeof n === "object" && n !== null)
      .map((n) => normalizeNode(n, width, height, legacy)),
  };
}

/**
 * Decide, unambiguously, whether a stored document is the legacy structured
 * schema. A document is legacy when:
 *   - its `version` is missing or below the current model version, AND
 *   - any page uses the old `elements` array (rather than `nodes`).
 * A document already at the current version is never treated as legacy, so its
 * absolute-pixel nodes are preserved verbatim regardless of their coordinates.
 */
function isLegacyDocument(raw: Record<string, unknown>): boolean {
  const version = num(raw.version, 0);
  if (version >= CANVAS_MODEL_VERSION) return false;
  const pages = Array.isArray(raw.pages) ? raw.pages : [];
  const usesElements = pages.some(
    (p) =>
      typeof p === "object" &&
      p !== null &&
      Array.isArray((p as Record<string, unknown>).elements) &&
      !Array.isArray((p as Record<string, unknown>).nodes),
  );
  // Legacy iff it predates v2 AND stores nodes under `elements`.
  return usesElements;
}

/**
 * Accept any stored value (current schema, legacy percentage schema, or
 * null/garbage) and return a valid, current-version CanvasDocument. Never
 * throws; always returns something renderable.
 */
export function normalizeCanvas(value: unknown): CanvasDocument {
  if (typeof value !== "object" || value === null) {
    return createDefaultCanvas();
  }
  const raw = value as Record<string, unknown>;
  const width = num(raw.width, DEFAULT_CANVAS_WIDTH);
  const height = num(raw.height, DEFAULT_CANVAS_HEIGHT);
  const legacy = isLegacyDocument(raw);
  const rawPages = Array.isArray(raw.pages) ? raw.pages : [];
  const pages =
    rawPages.length > 0
      ? rawPages
          .filter((p): p is Record<string, unknown> => typeof p === "object" && p !== null)
          .map((p, i) => normalizePage(p, i, width, height, legacy))
      : [normalizePage({}, 0, width, height, legacy)];
  const safePages = pages.length > 0 ? pages : [createEmptyPage()];
  const activePageId =
    typeof raw.activePageId === "string" &&
    safePages.some((p) => p.id === raw.activePageId)
      ? raw.activePageId
      : safePages[0]!.id;
  return {
    version: CANVAS_MODEL_VERSION,
    width,
    height,
    showGrid: bool(raw.showGrid, false),
    gridSize: num(raw.gridSize, 16),
    zoom: Math.min(2, Math.max(0.25, num(raw.zoom, 1))),
    activePageId,
    pages: safePages,
  };
}

// --- Selectors ------------------------------------------------------------

export function getActivePage(doc: CanvasDocument): CanvasPage {
  return doc.pages.find((p) => p.id === doc.activePageId) ?? doc.pages[0]!;
}

export function findNode(page: CanvasPage, id: string): CanvasNode | undefined {
  return page.nodes.find((n) => n.id === id);
}

/** Given a set of ids, expand to every node in any involved group. */
export function expandGroupSelection(page: CanvasPage, ids: string[]): string[] {
  const groups = new Set<string>();
  for (const id of ids) {
    const node = findNode(page, id);
    if (node?.groupId) groups.add(node.groupId);
  }
  if (groups.size === 0) return ids;
  const expanded = new Set(ids);
  for (const node of page.nodes) {
    if (node.groupId && groups.has(node.groupId)) expanded.add(node.id);
  }
  return page.nodes.filter((n) => expanded.has(n.id)).map((n) => n.id);
}
