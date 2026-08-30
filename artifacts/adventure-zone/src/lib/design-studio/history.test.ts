// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  commit,
  createHistory,
  redo,
  set,
  undo,
} from "./history";
import { createDefaultCanvas, type CanvasDocument } from "./model";

function withGrid(doc: CanvasDocument, showGrid: boolean): CanvasDocument {
  return { ...doc, showGrid };
}

describe("history", () => {
  it("starts empty", () => {
    const h = createHistory(createDefaultCanvas());
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("set updates present without adding history", () => {
    const initial = createDefaultCanvas();
    let h = createHistory(initial);
    h = set(h, withGrid(initial, true));
    expect(h.present.showGrid).toBe(true);
    expect(canUndo(h)).toBe(false);
  });

  it("commit records one entry per gesture", () => {
    const initial = createDefaultCanvas();
    let h = createHistory(initial);
    const next = withGrid(initial, true);
    h = commit(h, next);
    expect(canUndo(h)).toBe(true);
    expect(h.present.showGrid).toBe(true);
    expect(h.future).toHaveLength(0);
  });

  it("treats live set + single commit as one undo step", () => {
    const initial = createDefaultCanvas();
    let h = createHistory(initial);
    // simulate a drag: several live updates then one commit
    h = set(h, { ...initial, gridSize: 10 });
    h = set(h, { ...initial, gridSize: 20 });
    h = commit(h, { ...initial, gridSize: 32 });
    expect(h.past).toHaveLength(1); // one gesture -> one entry
    h = undo(h);
    expect(h.present.gridSize).toBe(initial.gridSize);
  });

  it("undo and redo move between states", () => {
    const initial = createDefaultCanvas();
    let h = createHistory(initial);
    const a = withGrid(initial, true);
    h = commit(h, a);
    h = undo(h);
    expect(h.present.showGrid).toBe(false);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present.showGrid).toBe(true);
  });

  it("commit clears the redo stack", () => {
    const initial = createDefaultCanvas();
    let h = createHistory(initial);
    h = commit(h, withGrid(initial, true));
    h = undo(h);
    expect(canRedo(h)).toBe(true);
    h = commit(h, { ...initial, gridSize: 99 });
    expect(canRedo(h)).toBe(false);
  });

  it("undo/redo are no-ops at the ends", () => {
    const h = createHistory(createDefaultCanvas());
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });
});