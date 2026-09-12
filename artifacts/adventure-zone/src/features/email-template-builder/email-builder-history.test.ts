import { describe, expect, it } from "vitest";

import { createEmailBlock } from "./email-builder-types";
import { builderReducer, createBuilderHistory } from "./email-builder-history";

describe("builderReducer", () => {
  it("adds, reorders, duplicates, removes, undoes, and redoes blocks", () => {
    const text = createEmailBlock("text", "text-1");
    const hero = createEmailBlock("hero", "hero-1");
    let state = createBuilderHistory({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: [text],
    });

    state = builderReducer(state, { type: "add", block: hero });
    expect(state.present.blocks.map((block) => block.id)).toEqual(["text-1", "hero-1"]);
    state = builderReducer(state, { type: "move", id: "hero-1", toIndex: 0 });
    expect(state.present.blocks[0]?.id).toBe("hero-1");
    state = builderReducer(state, { type: "duplicate", id: "hero-1", newId: "hero-2" });
    expect(state.present.blocks.map((block) => block.id)).toEqual(["hero-1", "hero-2", "text-1"]);
    state = builderReducer(state, { type: "remove", id: "hero-1" });
    expect(state.present.blocks.map((block) => block.id)).toEqual(["hero-2", "text-1"]);
    state = builderReducer(state, { type: "undo" });
    expect(state.present.blocks).toHaveLength(3);
    state = builderReducer(state, { type: "redo" });
    expect(state.present.blocks).toHaveLength(2);
  });

  it("clears redo history after a new edit", () => {
    const initial = createBuilderHistory({
      version: 1,
      settings: { backgroundColor: "#f8f6f1", contentWidth: 640 },
      blocks: [createEmailBlock("text", "text-1")],
    });
    const added = builderReducer(initial, { type: "add", block: createEmailBlock("hero", "hero-1") });
    const undone = builderReducer(added, { type: "undo" });
    const edited = builderReducer(undone, { type: "update", id: "text-1", patch: { content: "Changed" } });

    expect(edited.future).toHaveLength(0);
  });

  it("drops preserved legacy markup only from the block the user edits", () => {
    const text = { ...createEmailBlock("text", "text-1"), sourceHtml: "<tr><td>Original</td></tr>" };
    const state = createBuilderHistory({ version: 1, settings: { backgroundColor: "#f8f6f1", contentWidth: 640 }, blocks: [text] });
    const edited = builderReducer(state, { type: "update", id: "text-1", patch: { content: "Changed" } });

    expect(edited.present.blocks[0]).not.toHaveProperty("sourceHtml");
    expect(edited.present.blocks[0]).toMatchObject({ content: "Changed" });
  });
});
