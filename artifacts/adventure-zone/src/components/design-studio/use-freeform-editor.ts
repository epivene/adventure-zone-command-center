import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  alignNodes,
  addNode,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  moveNodes,
  pasteNodes,
  reorderNode,
  ungroupNodes,
  updateNodes,
  type AlignEdge,
  type ReorderDirection,
} from "@/lib/design-studio/commands";
import {
  canRedo as historyCanRedo,
  canUndo as historyCanUndo,
  commit,
  createHistory,
  redo as historyRedo,
  set as historySet,
  undo as historyUndo,
  type HistoryState,
} from "@/lib/design-studio/history";
import {
  expandGroupSelection,
  getActivePage,
  type CanvasDocument,
  type CanvasNode,
} from "@/lib/design-studio/model";
import { snapToGrid } from "@/lib/design-studio/geometry";

export type FreeformEditor = ReturnType<typeof useFreeformEditor>;

type ClipboardState = { nodes: CanvasNode[] };

/**
 * Central controller for the freeform canvas. Owns the history stack, current
 * selection, and the clipboard, and exposes gesture-aware commit/live-update
 * helpers plus keyboard handling. `onChange` fires whenever the committed
 * document changes so the page can mark itself dirty and autosave.
 */
export function useFreeformEditor(
  initial: CanvasDocument,
  options: { canEdit: boolean; onChange: (doc: CanvasDocument) => void },
) {
  const [history, setHistory] = useState<HistoryState>(() =>
    createHistory(initial),
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const clipboard = useRef<ClipboardState | null>(null);
  const initializedFor = useRef<CanvasDocument | null>(initial);

  const onChangeRef = useRef(options.onChange);
  onChangeRef.current = options.onChange;
  const canEditRef = useRef(options.canEdit);
  canEditRef.current = options.canEdit;

  // Reset history when a genuinely new document arrives (e.g. project loaded).
  useEffect(() => {
    if (initializedFor.current !== initial) {
      initializedFor.current = initial;
      setHistory(createHistory(initial));
      setSelectedIds([]);
    }
  }, [initial]);

  const doc = history.present;
  const page = useMemo(() => getActivePage(doc), [doc]);
  const canEdit = options.canEdit;

  const selectedNodes = useMemo(
    () => page.nodes.filter((n) => selectedIds.includes(n.id)),
    [page.nodes, selectedIds],
  );

  // --- History-aware document mutation ------------------------------------

  /** Commit a completed change as one undo step and notify the page. */
  const commitDoc = useCallback((next: CanvasDocument) => {
    setHistory((h) => {
      const committed = commit(h, next);
      if (committed.present !== h.present) onChangeRef.current(committed.present);
      return committed;
    });
  }, []);

  /** Live update during a gesture (no history entry). */
  const setDoc = useCallback((next: CanvasDocument) => {
    setHistory((h) => historySet(h, next));
  }, []);

  /** Finish a drag/resize gesture: promote the current present to a commit. */
  const commitGesture = useCallback(() => {
    setHistory((h) => {
      const committed = commit(h, h.present);
      if (committed.present !== h.baseline) onChangeRef.current(committed.present);
      return committed;
    });
  }, []);

  const apply = useCallback(
    (mutator: (current: CanvasDocument) => CanvasDocument) => {
      if (!canEditRef.current) return;
      setHistory((h) => {
        const next = mutator(h.present);
        const committed = commit(h, next);
        if (committed.present !== h.present) onChangeRef.current(committed.present);
        return committed;
      });
    },
    [],
  );

  // --- Selection ----------------------------------------------------------

  // `page` is a stable ref target for selection helpers so they can read the
  // current page without nesting one state setter inside another.
  const pageRef = useRef(page);
  pageRef.current = page;

  const select = useCallback((id: string | null, additive = false) => {
    if (id === null) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds((prev) => {
      const base = additive
        ? prev.includes(id)
          ? prev.filter((x) => x !== id)
          : [...prev, id]
        : [id];
      return expandGroupSelection(pageRef.current, base);
    });
  }, []);

  const setSelection = useCallback((ids: string[]) => {
    setSelectedIds(expandGroupSelection(pageRef.current, ids));
  }, []);

  // --- Node operations ----------------------------------------------------

  const insertNode = useCallback(
    (node: CanvasNode) => {
      if (!canEditRef.current) return;
      apply((d) => addNode(d, node));
      setSelectedIds([node.id]);
    },
    [apply],
  );

  const patchSelected = useCallback(
    (patch: Partial<CanvasNode>) => {
      if (selectedIds.length === 0) return;
      apply((d) => updateNodes(d, selectedIds, patch));
    },
    [apply, selectedIds],
  );

  const patchNodes = useCallback(
    (ids: string[], patch: Partial<CanvasNode>) => {
      apply((d) => updateNodes(d, ids, patch));
    },
    [apply],
  );

  const removeSelected = useCallback(() => {
    if (selectedIds.length === 0) return;
    apply((d) => deleteNodes(d, selectedIds));
    setSelectedIds([]);
  }, [apply, selectedIds]);

  const duplicateSelected = useCallback(() => {
    if (selectedIds.length === 0 || !canEditRef.current) return;
    const { doc: next, newIds } = duplicateNodes(doc, selectedIds);
    setHistory((h) => {
      const committed = commit(h, next);
      onChangeRef.current(committed.present);
      return committed;
    });
    setSelectedIds(newIds);
  }, [doc, selectedIds]);

  const copySelected = useCallback(() => {
    if (selectedNodes.length === 0) return;
    clipboard.current = { nodes: selectedNodes.map((n) => ({ ...n })) };
  }, [selectedNodes]);

  const paste = useCallback(() => {
    if (!clipboard.current || !canEditRef.current) return;
    const nodes = clipboard.current.nodes;
    let pastedIds: string[] = [];
    setHistory((h) => {
      const { doc: next, newIds } = pasteNodes(h.present, nodes);
      pastedIds = newIds;
      const committed = commit(h, next);
      onChangeRef.current(committed.present);
      return committed;
    });
    setSelectedIds(pastedIds);
  }, []);

  const group = useCallback(() => {
    if (selectedIds.length < 2) return;
    apply((d) => groupNodes(d, selectedIds));
  }, [apply, selectedIds]);

  const ungroup = useCallback(() => {
    if (selectedIds.length === 0) return;
    apply((d) => ungroupNodes(d, selectedIds));
  }, [apply, selectedIds]);

  const reorder = useCallback(
    (id: string, direction: ReorderDirection) => {
      apply((d) => reorderNode(d, id, direction));
    },
    [apply],
  );

  const align = useCallback(
    (edge: AlignEdge) => {
      if (selectedIds.length < 2) return;
      apply((d) => alignNodes(d, selectedIds, edge));
    },
    [apply, selectedIds],
  );

  const nudge = useCallback(
    (dx: number, dy: number) => {
      if (selectedIds.length === 0) return;
      apply((d) => moveNodes(d, selectedIds, dx, dy));
    },
    [apply, selectedIds],
  );

  // --- Document-level toggles --------------------------------------------

  const toggleGrid = useCallback(() => {
    apply((d) => ({ ...d, showGrid: !d.showGrid }));
  }, [apply]);

  const setActivePage = useCallback((pageId: string) => {
    setHistory((h) => historySet(h, { ...h.present, activePageId: pageId }));
    setSelectedIds([]);
  }, []);

  // Zoom is view-only: update present without touching history or dirty state.
  const setZoom = useCallback((zoom: number) => {
    const clamped = Math.min(2, Math.max(0.25, zoom));
    setHistory((h) => historySet(h, { ...h.present, zoom: clamped }));
  }, []);

  const undo = useCallback(() => {
    setHistory((h) => {
      const next = historyUndo(h);
      if (next !== h) onChangeRef.current(next.present);
      return next;
    });
    setSelectedIds([]);
  }, []);

  const redo = useCallback(() => {
    setHistory((h) => {
      const next = historyRedo(h);
      if (next !== h) onChangeRef.current(next.present);
      return next;
    });
    setSelectedIds([]);
  }, []);

  // --- Keyboard shortcuts -------------------------------------------------

  const handlerRef = useRef({
    undo,
    redo,
    removeSelected,
    duplicateSelected,
    copySelected,
    paste,
    group,
    ungroup,
    nudge,
    select,
  });
  handlerRef.current = {
    undo,
    redo,
    removeSelected,
    duplicateSelected,
    copySelected,
    paste,
    group,
    ungroup,
    nudge,
    select,
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      if (!canEditRef.current) return;
      const meta = event.metaKey || event.ctrlKey;
      const h = handlerRef.current;

      if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) h.redo();
        else h.undo();
        return;
      }
      if (meta && event.key.toLowerCase() === "y") {
        event.preventDefault();
        h.redo();
        return;
      }
      if (meta && event.key.toLowerCase() === "d") {
        event.preventDefault();
        h.duplicateSelected();
        return;
      }
      if (meta && event.key.toLowerCase() === "c") {
        h.copySelected();
        return;
      }
      if (meta && event.key.toLowerCase() === "v") {
        h.paste();
        return;
      }
      if (meta && event.key.toLowerCase() === "g") {
        event.preventDefault();
        if (event.shiftKey) h.ungroup();
        else h.group();
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        h.removeSelected();
        return;
      }
      if (event.key === "Escape") {
        h.select(null);
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowUp") {
        event.preventDefault();
        h.nudge(0, -step);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        h.nudge(0, step);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        h.nudge(-step, 0);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        h.nudge(step, 0);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const gridSnap = useCallback(
    (value: number) => (doc.showGrid ? snapToGrid(value, doc.gridSize) : value),
    [doc.showGrid, doc.gridSize],
  );

  return {
    doc,
    page,
    canEdit,
    selectedIds,
    selectedNodes,
    canUndo: historyCanUndo(history),
    canRedo: historyCanRedo(history),
    hasClipboard: clipboard.current !== null,
    // gesture-aware doc mutation
    setDoc,
    commitDoc,
    commitGesture,
    // selection
    select,
    setSelection,
    // ops
    insertNode,
    patchSelected,
    patchNodes,
    removeSelected,
    duplicateSelected,
    copySelected,
    paste,
    group,
    ungroup,
    reorder,
    align,
    nudge,
    toggleGrid,
    setActivePage,
    setZoom,
    undo,
    redo,
    gridSnap,
  };
}
