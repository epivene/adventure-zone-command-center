// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  addNode,
  alignNodes,
  deleteNodes,
  duplicateNodes,
  groupNodes,
  moveNodes,
  reorderNode,
  ungroupNodes,
  updateNodes,
} from "./commands";
import {
  createDefaultCanvas,
  createShapeNode,
  getActivePage,
  type CanvasDocument,
} from "./model";

function docWith(...nodes: ReturnType<typeof createShapeNode>[]): CanvasDocument {
  const doc = createDefaultCanvas();
  doc.pages[0]!.nodes = nodes;
  return doc;
}

describe("addNode / updateNodes / moveNodes", () => {
  it("adds a node immutably", () => {
    const doc = createDefaultCanvas();
    const before = getActivePage(doc).nodes.length;
    const next = addNode(doc, createShapeNode("rectangle"));
    expect(getActivePage(next).nodes.length).toBe(before + 1);
    expect(getActivePage(doc).nodes.length).toBe(before); // unchanged
  });

  it("does not update locked nodes unless unlocking", () => {
    const locked = createShapeNode("circle", { id: "a", locked: true });
    const doc = docWith(locked);
    const noop = updateNodes(doc, ["a"], { fill: "red" });
    expect((getActivePage(noop).nodes[0] as { fill: string }).fill).toBe(locked.fill);
    const unlocked = updateNodes(doc, ["a"], { locked: false });
    expect(getActivePage(unlocked).nodes[0]!.locked).toBe(false);
  });

  it("moves only unlocked selected nodes", () => {
    const a = createShapeNode("rectangle", { id: "a", x: 0, y: 0 });
    const b = createShapeNode("circle", { id: "b", x: 0, y: 0, locked: true });
    const doc = docWith(a, b);
    const next = moveNodes(doc, ["a", "b"], 10, 5);
    expect(getActivePage(next).nodes[0]!.x).toBe(10);
    expect(getActivePage(next).nodes[1]!.x).toBe(0); // locked stays
  });
});

describe("deleteNodes", () => {
  it("removes selected but keeps locked", () => {
    const a = createShapeNode("rectangle", { id: "a" });
    const b = createShapeNode("circle", { id: "b", locked: true });
    const doc = docWith(a, b);
    const next = deleteNodes(doc, ["a", "b"]);
    expect(getActivePage(next).nodes.map((n) => n.id)).toEqual(["b"]);
  });
});

describe("duplicateNodes", () => {
  it("creates offset copies with fresh ids", () => {
    const a = createShapeNode("rectangle", { id: "a", x: 100, y: 100 });
    const doc = docWith(a);
    const { doc: next, newIds } = duplicateNodes(doc, ["a"], 24);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe("a");
    const copy = getActivePage(next).nodes.find((n) => n.id === newIds[0])!;
    expect(copy.x).toBe(124);
    expect(copy.y).toBe(124);
  });

  it("remaps shared group ids among copies", () => {
    const a = createShapeNode("rectangle", { id: "a", groupId: "g" });
    const b = createShapeNode("circle", { id: "b", groupId: "g" });
    const doc = docWith(a, b);
    const { doc: next, newIds } = duplicateNodes(doc, ["a", "b"]);
    const copies = getActivePage(next).nodes.filter((n) => newIds.includes(n.id));
    expect(copies[0]!.groupId).toBe(copies[1]!.groupId);
    expect(copies[0]!.groupId).not.toBe("g");
  });
});

describe("group / ungroup", () => {
  it("assigns a shared groupId to 2+ nodes and ungroups them", () => {
    const a = createShapeNode("rectangle", { id: "a" });
    const b = createShapeNode("circle", { id: "b" });
    const doc = docWith(a, b);
    const grouped = groupNodes(doc, ["a", "b"]);
    const gid = getActivePage(grouped).nodes[0]!.groupId;
    expect(gid).not.toBeNull();
    expect(getActivePage(grouped).nodes[1]!.groupId).toBe(gid);
    const ungrouped = ungroupNodes(grouped, ["a"]);
    expect(getActivePage(ungrouped).nodes.every((n) => n.groupId === null)).toBe(true);
  });

  it("ignores group of a single node", () => {
    const a = createShapeNode("rectangle", { id: "a" });
    const doc = docWith(a);
    expect(groupNodes(doc, ["a"])).toBe(doc);
  });

  it("never alters a locked node when grouping", () => {
    const a = createShapeNode("rectangle", { id: "a" });
    const b = createShapeNode("circle", { id: "b" });
    const locked = createShapeNode("star", { id: "c", locked: true, groupId: null });
    const doc = docWith(a, b, locked);
    const grouped = groupNodes(doc, ["a", "b", "c"]);
    const nodes = getActivePage(grouped).nodes;
    const gid = nodes.find((n) => n.id === "a")!.groupId;
    expect(gid).not.toBeNull();
    expect(nodes.find((n) => n.id === "b")!.groupId).toBe(gid);
    // Locked node keeps its original (null) group membership.
    expect(nodes.find((n) => n.id === "c")!.groupId).toBeNull();
  });

  it("returns the doc unchanged when fewer than 2 unlocked targets remain", () => {
    const a = createShapeNode("rectangle", { id: "a" });
    const locked = createShapeNode("circle", { id: "b", locked: true });
    const doc = docWith(a, locked);
    expect(groupNodes(doc, ["a", "b"])).toBe(doc);
  });

  it("never alters a locked node when ungrouping its group peers", () => {
    const a = createShapeNode("rectangle", { id: "a", groupId: "g" });
    const b = createShapeNode("circle", { id: "b", groupId: "g" });
    const locked = createShapeNode("star", { id: "c", groupId: "g", locked: true });
    const doc = docWith(a, b, locked);
    const ungrouped = ungroupNodes(doc, ["a"]);
    const nodes = getActivePage(ungrouped).nodes;
    expect(nodes.find((n) => n.id === "a")!.groupId).toBeNull();
    expect(nodes.find((n) => n.id === "b")!.groupId).toBeNull();
    // Locked node retains its group membership.
    expect(nodes.find((n) => n.id === "c")!.groupId).toBe("g");
  });
});

describe("reorderNode", () => {
  it("moves a node to front and back in z-order", () => {
    const a = createShapeNode("rectangle", { id: "a" });
    const b = createShapeNode("circle", { id: "b" });
    const c = createShapeNode("star", { id: "c" });
    const doc = docWith(a, b, c);
    const front = reorderNode(doc, "a", "front");
    expect(getActivePage(front).nodes.map((n) => n.id)).toEqual(["b", "c", "a"]);
    const back = reorderNode(doc, "c", "back");
    expect(getActivePage(back).nodes.map((n) => n.id)).toEqual(["c", "a", "b"]);
    const forward = reorderNode(doc, "a", "forward");
    expect(getActivePage(forward).nodes.map((n) => n.id)).toEqual(["b", "a", "c"]);
  });
});

describe("alignNodes", () => {
  it("aligns left edges to the leftmost node", () => {
    const a = createShapeNode("rectangle", { id: "a", x: 100, width: 50 });
    const b = createShapeNode("circle", { id: "b", x: 200, width: 50 });
    const doc = docWith(a, b);
    const next = alignNodes(doc, ["a", "b"], "left");
    expect(getActivePage(next).nodes[0]!.x).toBe(100);
    expect(getActivePage(next).nodes[1]!.x).toBe(100);
  });

  it("centers horizontally on the combined bounds", () => {
    const a = createShapeNode("rectangle", { id: "a", x: 0, width: 100 });
    const b = createShapeNode("circle", { id: "b", x: 300, width: 100 });
    const doc = docWith(a, b);
    const next = alignNodes(doc, ["a", "b"], "center-h");
    const mid = (0 + 400) / 2;
    expect(getActivePage(next).nodes[0]!.x + 50).toBe(mid);
    expect(getActivePage(next).nodes[1]!.x + 50).toBe(mid);
  });
});