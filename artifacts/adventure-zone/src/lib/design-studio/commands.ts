// Pure commands that transform a CanvasDocument. Every command returns a new
// document (immutable) and never mutates its input, so they compose cleanly
// with the history stack. Locked and hidden nodes are respected here so the UI
// layer does not have to re-implement the rules.

import {
  createId,
  expandGroupSelection,
  getActivePage,
  type CanvasDocument,
  type CanvasNode,
  type CanvasPage,
} from "./model";

function mapActivePage(
  doc: CanvasDocument,
  fn: (page: CanvasPage) => CanvasPage,
): CanvasDocument {
  return {
    ...doc,
    pages: doc.pages.map((page) =>
      page.id === doc.activePageId ? fn(page) : page,
    ),
  };
}

function mapNodes(
  doc: CanvasDocument,
  fn: (node: CanvasNode) => CanvasNode,
): CanvasDocument {
  return mapActivePage(doc, (page) => ({
    ...page,
    nodes: page.nodes.map(fn),
  }));
}

export function addNode(doc: CanvasDocument, node: CanvasNode): CanvasDocument {
  return mapActivePage(doc, (page) => ({
    ...page,
    nodes: [...page.nodes, node],
  }));
}

/** Patch fields on specific nodes, skipping locked nodes unless unlocking. */
export function updateNodes(
  doc: CanvasDocument,
  ids: string[],
  patch: Partial<CanvasNode>,
): CanvasDocument {
  const idSet = new Set(ids);
  return mapNodes(doc, (node) => {
    if (!idSet.has(node.id)) return node;
    const isUnlocking = patch.locked === false;
    if (node.locked && !isUnlocking) return node;
    return { ...node, ...patch } as CanvasNode;
  });
}

/** Move a set of nodes by a delta, skipping locked nodes. */
export function moveNodes(
  doc: CanvasDocument,
  ids: string[],
  dx: number,
  dy: number,
): CanvasDocument {
  const idSet = new Set(ids);
  return mapNodes(doc, (node) => {
    if (!idSet.has(node.id) || node.locked) return node;
    return { ...node, x: node.x + dx, y: node.y + dy };
  });
}

export function deleteNodes(doc: CanvasDocument, ids: string[]): CanvasDocument {
  const idSet = new Set(ids);
  return mapActivePage(doc, (page) => ({
    ...page,
    nodes: page.nodes.filter((n) => !idSet.has(n.id) || n.locked),
  }));
}

/**
 * Duplicate nodes with a small offset and fresh ids. Preserves group structure
 * by remapping any shared groupIds among the copies. Returns the new document
 * and the ids of the created copies (for reselection).
 */
export function duplicateNodes(
  doc: CanvasDocument,
  ids: string[],
  offset = 24,
): { doc: CanvasDocument; newIds: string[] } {
  const page = getActivePage(doc);
  const originals = page.nodes.filter((n) => ids.includes(n.id));
  const groupRemap = new Map<string, string>();
  const newIds: string[] = [];
  const copies = originals.map((node) => {
    const id = createId(node.kind);
    newIds.push(id);
    let groupId = node.groupId;
    if (groupId) {
      if (!groupRemap.has(groupId)) groupRemap.set(groupId, createId("group"));
      groupId = groupRemap.get(groupId)!;
    }
    return {
      ...node,
      id,
      groupId,
      x: node.x + offset,
      y: node.y + offset,
    } as CanvasNode;
  });
  return {
    doc: mapActivePage(doc, (p) => ({ ...p, nodes: [...p.nodes, ...copies] })),
    newIds,
  };
}

/** Paste externally-copied nodes as fresh copies. */
export function pasteNodes(
  doc: CanvasDocument,
  nodes: CanvasNode[],
  offset = 24,
): { doc: CanvasDocument; newIds: string[] } {
  const groupRemap = new Map<string, string>();
  const newIds: string[] = [];
  const copies = nodes.map((node) => {
    const id = createId(node.kind);
    newIds.push(id);
    let groupId = node.groupId;
    if (groupId) {
      if (!groupRemap.has(groupId)) groupRemap.set(groupId, createId("group"));
      groupId = groupRemap.get(groupId)!;
    }
    return { ...node, id, groupId, x: node.x + offset, y: node.y + offset } as CanvasNode;
  });
  return {
    doc: mapActivePage(doc, (p) => ({ ...p, nodes: [...p.nodes, ...copies] })),
    newIds,
  };
}

/**
 * Group the given nodes under a new shared groupId. Locked nodes are never
 * altered (their group membership is left untouched). Needs 2+ unlocked
 * targets, otherwise the document is returned unchanged.
 */
export function groupNodes(doc: CanvasDocument, ids: string[]): CanvasDocument {
  const page = getActivePage(doc);
  const targets = ids.filter((id) => {
    const node = page.nodes.find((n) => n.id === id);
    return node && !node.locked;
  });
  if (targets.length < 2) return doc;
  const groupId = createId("group");
  const idSet = new Set(targets);
  return mapNodes(doc, (node) =>
    idSet.has(node.id) && !node.locked ? { ...node, groupId } : node,
  );
}

/**
 * Remove the group membership from the given nodes (and their group peers).
 * Locked nodes keep their group membership so they are never modified.
 */
export function ungroupNodes(doc: CanvasDocument, ids: string[]): CanvasDocument {
  const page = getActivePage(doc);
  const expanded = new Set(expandGroupSelection(page, ids));
  return mapNodes(doc, (node) =>
    expanded.has(node.id) && !node.locked ? { ...node, groupId: null } : node,
  );
}

export type ReorderDirection = "front" | "back" | "forward" | "backward";

/** Reorder a single node within the z-stack (nodes array order == z-order). */
export function reorderNode(
  doc: CanvasDocument,
  id: string,
  direction: ReorderDirection,
): CanvasDocument {
  return mapActivePage(doc, (page) => {
    const index = page.nodes.findIndex((n) => n.id === id);
    if (index === -1) return page;
    const nodes = [...page.nodes];
    const [node] = nodes.splice(index, 1);
    if (direction === "front") nodes.push(node!);
    else if (direction === "back") nodes.unshift(node!);
    else if (direction === "forward")
      nodes.splice(Math.min(nodes.length, index + 1), 0, node!);
    else nodes.splice(Math.max(0, index - 1), 0, node!);
    return { ...page, nodes };
  });
}

/** Move a node to an absolute z-index (used by drag-reorder in the layer list). */
export function moveNodeToIndex(
  doc: CanvasDocument,
  id: string,
  targetIndex: number,
): CanvasDocument {
  return mapActivePage(doc, (page) => {
    const index = page.nodes.findIndex((n) => n.id === id);
    if (index === -1) return page;
    const nodes = [...page.nodes];
    const [node] = nodes.splice(index, 1);
    const clamped = Math.max(0, Math.min(nodes.length, targetIndex));
    nodes.splice(clamped, 0, node!);
    return { ...page, nodes };
  });
}

export type AlignEdge =
  | "left"
  | "center-h"
  | "right"
  | "top"
  | "center-v"
  | "bottom";

/** Align selected nodes to a shared edge based on their combined bounding box. */
export function alignNodes(
  doc: CanvasDocument,
  ids: string[],
  edge: AlignEdge,
): CanvasDocument {
  const page = getActivePage(doc);
  const targets = page.nodes.filter((n) => ids.includes(n.id) && !n.locked);
  if (targets.length < 2) return doc;
  const minX = Math.min(...targets.map((n) => n.x));
  const maxX = Math.max(...targets.map((n) => n.x + n.width));
  const minY = Math.min(...targets.map((n) => n.y));
  const maxY = Math.max(...targets.map((n) => n.y + n.height));
  const idSet = new Set(targets.map((n) => n.id));
  return mapNodes(doc, (node) => {
    if (!idSet.has(node.id)) return node;
    switch (edge) {
      case "left":
        return { ...node, x: minX };
      case "right":
        return { ...node, x: maxX - node.width };
      case "center-h":
        return { ...node, x: (minX + maxX) / 2 - node.width / 2 };
      case "top":
        return { ...node, y: minY };
      case "bottom":
        return { ...node, y: maxY - node.height };
      case "center-v":
        return { ...node, y: (minY + maxY) / 2 - node.height / 2 };
      default:
        return node;
    }
  });
}
