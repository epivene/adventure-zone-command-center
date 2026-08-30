// Undo/redo history with one entry per user gesture.
//
// The store keeps a `present` document plus `past`/`future` stacks, and a
// `baseline` marking the last committed state. During a continuous gesture
// (drag, resize, rotate) the UI calls `set` for live feedback: this updates
// `present` for rendering but does NOT change `baseline` or the stacks. When the
// gesture ends the UI calls `commit`, which pushes the `baseline` (the state
// before the gesture began) onto `past` and promotes the final doc to both
// `present` and `baseline`. The net result is exactly one undo step per gesture,
// no matter how many live `set` calls happened in between.

import type { CanvasDocument } from "./model";

export type HistoryState = {
  past: CanvasDocument[];
  present: CanvasDocument;
  future: CanvasDocument[];
  /** Last committed document; the anchor a `commit` pushes onto `past`. */
  baseline: CanvasDocument;
};

const MAX_DEPTH = 100;

export function createHistory(initial: CanvasDocument): HistoryState {
  return { past: [], present: initial, future: [], baseline: initial };
}

/** Live update with no new history entry (used during an in-progress gesture). */
export function set(state: HistoryState, next: CanvasDocument): HistoryState {
  if (next === state.present) return state;
  return { ...state, present: next };
}

/**
 * Commit a completed gesture: push the pre-gesture `baseline` onto `past`, set
 * the new present/baseline, and clear the redo stack. This is the single history
 * entry for the whole gesture regardless of how many `set` calls preceded it.
 */
export function commit(
  state: HistoryState,
  next: CanvasDocument,
): HistoryState {
  if (next === state.baseline) {
    // Nothing effectively changed since the last commit; just sync present.
    return { ...state, present: next };
  }
  const past = [...state.past, state.baseline];
  if (past.length > MAX_DEPTH) past.shift();
  return { past, present: next, future: [], baseline: next };
}

export function canUndo(state: HistoryState): boolean {
  return state.past.length > 0;
}

export function canRedo(state: HistoryState): boolean {
  return state.future.length > 0;
}

export function undo(state: HistoryState): HistoryState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1]!;
  return {
    past: state.past.slice(0, -1),
    present: previous,
    future: [state.baseline, ...state.future],
    baseline: previous,
  };
}

export function redo(state: HistoryState): HistoryState {
  if (state.future.length === 0) return state;
  const next = state.future[0]!;
  return {
    past: [...state.past, state.baseline],
    present: next,
    future: state.future.slice(1),
    baseline: next,
  };
}
