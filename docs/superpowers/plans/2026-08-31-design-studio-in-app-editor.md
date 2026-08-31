# Design Studio In-App Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a real, mobile-friendly visual editor inside Adventure Zone Command Center so the five Adventure Zone starter templates open as editable canvas documents instead of text-only Canva handoff projects.

**Architecture:** Reuse the existing `CanvasDocument`, `useFreeformEditor`, command/history/geometry modules, and low-level freeform canvas components. Replace the current stripped-down project page with a simpler Canva-style shell: canvas first, compact top controls, contextual bottom editing tools, on-demand layers/assets sheets, and debounced persistence to `design_projects.canvas`.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, Radix UI components, existing Design Studio canvas model/commands/history, Vitest + Testing Library, existing authenticated Design Studio API.

**Spec:** `docs/superpowers/specs/2026-08-31-design-studio-canva-handoff-design.md`

## Global Constraints

- Command Center is the primary editor and source of truth.
- Canva must remain optional.
- Do not restore the old permanent three-panel desktop editor UI.
- Mobile canvas is primary; selected-element controls belong in a contextual bottom toolbar.
- Existing immutable `used`, `sent`, and archived project protections stay intact.
- Reuse the existing canvas model and editor command/history infrastructure where sound.
- Starter templates must be real editable `CanvasDocument` JSON, not screenshots and not text prompts.
- V1 supports text, images, basic shapes/stickers, drag, resize, rotate, layer order, duplicate/delete, lock/unlock, undo/redo, zoom/pan, autosave, PNG/PDF export hooks.

---

### Task 1: Convert the five branded starters into real canvas documents

**Files:**
- Modify: `artifacts/adventure-zone/src/lib/design-studio/canva-starters.ts`
- Modify: `artifacts/adventure-zone/src/lib/design-studio/model.ts`
- Create: `artifacts/adventure-zone/src/lib/design-studio/canva-starters.test.ts`

**Interfaces:**
- Consumes: `CanvasDocument`, `CanvasPage`, `CanvasNode`, `createTextNode`, `createImageNode`, `createShapeNode` from `model.ts`.
- Produces: `CanvaStarter.canvas: CanvasDocument` and `starterById(id: string): CanvaStarter | undefined`.

- [ ] **Step 1: Write failing tests for editable starter documents**

```ts
import { describe, expect, it } from "vitest";
import { CANVA_STARTERS, starterById } from "./canva-starters";
import { normalizeCanvas } from "./model";

describe("Adventure Zone canvas starters", () => {
  it("ships five starters with editable canvas documents", () => {
    expect(CANVA_STARTERS).toHaveLength(5);
    for (const starter of CANVA_STARTERS) {
      const canvas = normalizeCanvas(starter.canvas);
      expect(canvas.pages).toHaveLength(1);
      expect(canvas.pages[0]!.nodes.length).toBeGreaterThan(4);
      expect(canvas.pages[0]!.nodes.some((node) => node.kind === "text")).toBe(true);
    }
  });

  it("event flyer contains editable image and shape layers", () => {
    const starter = starterById("event-flyer")!;
    const nodes = starter.canvas.pages[0]!.nodes;
    expect(nodes.some((node) => node.kind === "image")).toBe(true);
    expect(nodes.some((node) => node.kind === "shape")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:
```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/design-studio/canva-starters.test.ts
```
Expected: FAIL because starters do not expose `canvas` or `starterById`.

- [ ] **Step 3: Extend the starter type and build the five canvas documents**

Add to `CanvaStarter`:
```ts
canvas: CanvasDocument;
```

Add:
```ts
export function starterById(id: string) {
  return CANVA_STARTERS.find((starter) => starter.id === id);
}
```

Build each starter with one page containing editable text/image/shape nodes. Use the approved Adventure Zone palette and the Meeteetse-style layout. Use image nodes with stable app asset references where available; otherwise use `assetId` placeholders resolved by Task 5.

- [ ] **Step 4: Run the starter tests and typecheck**

Run:
```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/design-studio/canva-starters.test.ts
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/lib/design-studio/canva-starters.ts artifacts/adventure-zone/src/lib/design-studio/model.ts artifacts/adventure-zone/src/lib/design-studio/canva-starters.test.ts
git commit -m "feat: make Design Studio starters editable canvases"
```

---

### Task 2: Create projects from starter canvas JSON instead of text-only notes

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioPage.tsx`
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Create: `artifacts/adventure-zone/src/pages/DesignStudioPage.test.tsx`

**Interfaces:**
- Consumes: `CanvaStarter.canvas` from Task 1.
- Produces: new projects whose `canvas` is populated on POST `/office/design-studio/projects`.

- [ ] **Step 1: Write failing component test**

```tsx
it("creates a project with the selected starter canvas", async () => {
  vi.spyOn(designStudioApi, "create").mockResolvedValue({
    id: "project-1",
    name: "Big Day Event Flyer",
    type: "flyer",
  });

  render(<DesignStudioPage />);
  await userEvent.click(await screen.findByRole("button", { name: /use this design/i }));

  expect(designStudioApi.create).toHaveBeenCalledWith(
    expect.objectContaining({
      canvas: expect.objectContaining({ pages: expect.any(Array) }),
    }),
  );
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:
```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/DesignStudioPage.test.tsx
```
Expected: FAIL because `useStarter` does not submit `canvas`.

- [ ] **Step 3: Update project creation**

Change `useStarter` to call:
```ts
await designStudioApi.create({
  type: starter.type,
  name: starter.name,
  content: starter.content,
  canvas: starter.canvas,
  notes: `CANVA_STARTER_ID=${starter.id}`,
});
```

Keep the existing text content only as copy/reference metadata; the canvas is the visual source of truth.

- [ ] **Step 4: Run tests and typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/DesignStudioPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/adventure-zone/src/pages/DesignStudioPage.tsx artifacts/adventure-zone/src/lib/design-studio-api.ts artifacts/adventure-zone/src/pages/DesignStudioPage.test.tsx
git commit -m "feat: create starter projects with canvas data"
```

---

### Task 3: Replace the current handoff page with the reusable canvas editor controller

**Files:**
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx`
- Reuse: `artifacts/adventure-zone/src/components/design-studio/use-freeform-editor.ts`
- Reuse: `artifacts/adventure-zone/src/components/design-studio/FreeformCanvas.tsx`
- Create: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.test.tsx`

**Interfaces:**
- Consumes: `normalizeCanvas(project.canvas)` and `useFreeformEditor(initial, { canEdit, onChange })`.
- Produces: editor page state with `editor.doc`, `editor.selectedNodes`, `editor.undo/redo`, `editor.patchSelected`, `editor.duplicateSelected`, `editor.removeSelected`, and debounced project save.

- [ ] **Step 1: Write failing test that a saved canvas renders and can be edited**

```tsx
it("opens the persisted project canvas instead of the Canva copy textarea", async () => {
  vi.spyOn(designStudioApi, "get").mockResolvedValue(projectWithCanvas);
  render(<DesignStudioEditorPage />);

  expect(await screen.findByTestId("design-canvas")).toBeInTheDocument();
  expect(screen.queryByText(/copy into canva/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/DesignStudioEditorPage.test.tsx
```
Expected: FAIL because the page still renders the Canva handoff UI.

- [ ] **Step 3: Restore the canvas controller, not the old desktop shell**

Use:
```ts
const [canvasDoc, setCanvasDoc] = useState<CanvasDocument | null>(null);
const latestCanvas = useRef<CanvasDocument | null>(null);
const editor = useFreeformEditor(canvasDoc ?? normalizeCanvas(null), {
  canEdit: project?.status !== "used" && project?.status !== "sent" && project?.status !== "archived",
  onChange: (doc) => {
    latestCanvas.current = doc;
    setDirty(true);
  },
});
```

Load with:
```ts
const doc = normalizeCanvas(value.canvas);
latestCanvas.current = doc;
setCanvasDoc(doc);
```

Render `FreeformCanvas` as the central content surface.

- [ ] **Step 4: Add 1200ms debounced autosave using the current canvas**

Save with:
```ts
await designStudioApi.update(project.id, {
  name,
  type: project.type,
  canvas: latestCanvas.current ?? editor.doc,
  syncState: "synced",
});
```

- [ ] **Step 5: Run component test + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/pages/DesignStudioEditorPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx artifacts/adventure-zone/src/pages/DesignStudioEditorPage.test.tsx
git commit -m "feat: restore canvas editing to Design Studio"
```

---

### Task 4: Add the mobile Canva-style top bar and contextual bottom toolbar

**Files:**
- Create: `artifacts/adventure-zone/src/components/design-studio/MobileEditorTopBar.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.tsx`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.test.tsx`

**Interfaces:**
- Consumes: `FreeformEditor` from `use-freeform-editor.ts`.
- Produces: compact controls for undo/redo/save/zoom and selected-element actions.

- [ ] **Step 1: Write failing toolbar test**

```tsx
it("shows text controls for a selected text node", () => {
  render(<ContextualBottomToolbar editor={textEditorFixture} />);
  expect(screen.getByRole("button", { name: /text size/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /text color/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /duplicate/i })).toBeInTheDocument();
});

it("shows replace photo for a selected image", () => {
  render(<ContextualBottomToolbar editor={imageEditorFixture} />);
  expect(screen.getByRole("button", { name: /replace photo/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/ContextualBottomToolbar.test.tsx
```

- [ ] **Step 3: Implement top bar**

Top bar includes:
```tsx
Back | Project name | Undo | Redo | Save state
```

Disable undo/redo from `editor.canUndo` / `editor.canRedo`.

- [ ] **Step 4: Implement contextual bottom toolbar**

Behavior:
```ts
if (selected.kind === "text") -> Text, Size, Color, Bold, Italic, Align, Duplicate, Delete
if (selected.kind === "image") -> Replace photo, Fit/Fill, Crop position, Duplicate, Delete
if (selected.kind === "shape") -> Fill, Stroke, Duplicate, Delete
if (!selected) -> Add text, Add photo, Add shape, Layers, Zoom
```

Use `editor.patchSelected`, `editor.duplicateSelected`, `editor.removeSelected`, `editor.reorder`, and `editor.setZoom`.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/ContextualBottomToolbar.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/design-studio/MobileEditorTopBar.tsx artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.tsx artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.test.tsx artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx
git commit -m "feat: add mobile Design Studio editor controls"
```

---

### Task 5: Add reusable Adventure Zone photo library and replace-photo flow

**Files:**
- Modify: `artifacts/adventure-zone/src/lib/design-studio-api.ts`
- Create: `artifacts/adventure-zone/src/components/design-studio/AssetPickerSheet.tsx`
- Modify: `artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.tsx`
- Modify: `artifacts/api-server/src/routes/office-design-studio.ts`
- Create: `artifacts/adventure-zone/src/components/design-studio/AssetPickerSheet.test.tsx`

**Interfaces:**
- Consumes: existing `designStudioApi.listAssets()` and `ImageNode.assetId`.
- Produces: selecting an asset updates the image node with `{ assetId, src: null, alt }` so signed URLs are never persisted.

- [ ] **Step 1: Write failing asset-picker test**

```tsx
it("replaces the selected image with an Adventure Zone asset id", async () => {
  render(<AssetPickerSheet assets={[asset]} onChoose={onChoose} />);
  await userEvent.click(screen.getByRole("button", { name: /sabretooth/i }));
  expect(onChoose).toHaveBeenCalledWith(asset);
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/AssetPickerSheet.test.tsx
```

- [ ] **Step 3: Implement picker and image-node replacement**

On choose:
```ts
editor.patchSelected({
  assetId: asset.id,
  src: null,
  alt: asset.altText ?? asset.name,
});
```

- [ ] **Step 4: Seed/store the supplied Adventure Zone photos as approved company assets**

Use the existing Design Studio asset storage route and mark the starter-set assets with:
```ts
scope: "company"
isApproved: true
```

Do not encode external signed URLs into starter JSON.

- [ ] **Step 5: Run test + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/AssetPickerSheet.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/lib/design-studio-api.ts artifacts/adventure-zone/src/components/design-studio/AssetPickerSheet.tsx artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.tsx artifacts/adventure-zone/src/components/design-studio/AssetPickerSheet.test.tsx artifacts/api-server/src/routes/office-design-studio.ts
git commit -m "feat: add Adventure Zone image picker"
```

---

### Task 6: Add on-demand layers sheet and sticker/shape insertion

**Files:**
- Create: `artifacts/adventure-zone/src/components/design-studio/LayersSheet.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/AddElementSheet.tsx`
- Modify: `artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.tsx`
- Create: `artifacts/adventure-zone/src/components/design-studio/LayersSheet.test.tsx`

**Interfaces:**
- Consumes: `editor.page.nodes`, `editor.reorder`, `editor.select`, `createTextNode`, `createShapeNode`.
- Produces: optional sheets for layer selection/reordering and adding text/stickers.

- [ ] **Step 1: Write failing layer-order test**

```tsx
it("moves a selected layer to the front", async () => {
  render(<LayersSheet editor={editorFixture} />);
  await userEvent.click(screen.getByRole("button", { name: /bring to front/i }));
  expect(editorFixture.reorder).toHaveBeenCalledWith("node-1", "front");
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/LayersSheet.test.tsx
```

- [ ] **Step 3: Implement on-demand layers sheet**

Display node name, type, lock state, and controls for:
```ts
"forward" | "backward" | "front" | "back"
```

- [ ] **Step 4: Implement element insertion sheet**

Support:
```ts
createTextNode()
createShapeNode("rectangle")
createShapeNode("circle")
createShapeNode("star")
createShapeNode("arrow")
```

Use preconfigured shape values for Adventure Zone price bubbles, brush banners, and sticker blocks.

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/components/design-studio/LayersSheet.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
```

- [ ] **Step 6: Commit**

```bash
git add artifacts/adventure-zone/src/components/design-studio/LayersSheet.tsx artifacts/adventure-zone/src/components/design-studio/AddElementSheet.tsx artifacts/adventure-zone/src/components/design-studio/ContextualBottomToolbar.tsx artifacts/adventure-zone/src/components/design-studio/LayersSheet.test.tsx
git commit -m "feat: add Design Studio layers and stickers"
```

---

### Task 7: Add direct PNG/PDF export hooks and finish mobile acceptance coverage

**Files:**
- Create: `artifacts/adventure-zone/src/lib/design-studio/export-canvas.ts`
- Create: `artifacts/adventure-zone/src/lib/design-studio/export-canvas.test.ts`
- Modify: `artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx`
- Modify: `artifacts/adventure-zone/src/components/design-studio/MobileEditorTopBar.tsx`

**Interfaces:**
- Consumes: saved `CanvasDocument`, resolved image URLs, current page size/background.
- Produces: `exportCanvasPng(doc, assets)` and `exportCanvasPdf(doc, assets)` hooks used by the editor and later Canva handoff plan.

- [ ] **Step 1: Write failing export tests**

```ts
it("exports the active canvas as a PNG blob", async () => {
  const result = await exportCanvasPng(canvasFixture, []);
  expect(result.type).toBe("image/png");
});

it("exports the active canvas as a PDF blob", async () => {
  const result = await exportCanvasPdf(canvasFixture, []);
  expect(result.type).toBe("application/pdf");
});
```

- [ ] **Step 2: Run RED**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/design-studio/export-canvas.test.ts
```

- [ ] **Step 3: Implement the export boundary**

Keep rendering/export logic isolated from the editor UI. The API must accept `CanvasDocument` and resolved assets only; it must not read React component state directly.

- [ ] **Step 4: Add Export menu to top bar**

Expose:
```text
Download PNG
Download PDF
```

- [ ] **Step 5: Run editor tests, typecheck, and build**

```bash
pnpm --filter @workspace/adventure-zone exec vitest run src/lib/design-studio src/components/design-studio src/pages/DesignStudioEditorPage.test.tsx
pnpm --filter @workspace/adventure-zone typecheck
pnpm --filter @workspace/adventure-zone build
```
Expected: all PASS.

- [ ] **Step 6: Manual Android acceptance**

Verify on phone-width layout:
```text
open starter → edit event name → replace image → drag text → rotate shape → undo → redo → reload → verify autosave → export PNG → export PDF
```

- [ ] **Step 7: Commit**

```bash
git add artifacts/adventure-zone/src/lib/design-studio/export-canvas.ts artifacts/adventure-zone/src/lib/design-studio/export-canvas.test.ts artifacts/adventure-zone/src/pages/DesignStudioEditorPage.tsx artifacts/adventure-zone/src/components/design-studio/MobileEditorTopBar.tsx
git commit -m "feat: add Design Studio direct exports"
```
