import type { EmailBuilderBlock, EmailBuilderDocument } from "@workspace/api-zod";

export type EmailBuilderHistoryState = {
  past: EmailBuilderDocument[];
  present: EmailBuilderDocument;
  future: EmailBuilderDocument[];
};

export type EmailBuilderAction =
  | { type: "reset"; document: EmailBuilderDocument }
  | { type: "add"; block: EmailBuilderBlock; atIndex?: number }
  | { type: "update"; id: string; patch: Record<string, unknown> }
  | { type: "move"; id: string; toIndex: number }
  | { type: "duplicate"; id: string; newId: string }
  | { type: "remove"; id: string }
  | { type: "settings"; patch: Partial<EmailBuilderDocument["settings"]> }
  | { type: "undo" }
  | { type: "redo" };

export function createBuilderHistory(document: EmailBuilderDocument): EmailBuilderHistoryState {
  return { past: [], present: document, future: [] };
}

function record(state: EmailBuilderHistoryState, present: EmailBuilderDocument): EmailBuilderHistoryState {
  if (present.settings.sourceHtml) {
    const { sourceHtml: _sourceHtml, ...settings } = present.settings;
    present = { ...present, settings };
  }
  if (JSON.stringify(present) === JSON.stringify(state.present)) return state;
  return { past: [...state.past.slice(-49), state.present], present, future: [] };
}

export function builderReducer(state: EmailBuilderHistoryState, action: EmailBuilderAction): EmailBuilderHistoryState {
  if (action.type === "reset") return { past: [...state.past.slice(-49), state.present], present: action.document, future: [] };
  if (action.type === "undo") {
    const previous = state.past.at(-1);
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state;
  }
  if (action.type === "redo") {
    const next = state.future[0];
    return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state;
  }
  if (action.type === "settings") return record(state, { ...state.present, settings: { ...state.present.settings, ...action.patch } });
  if (action.type === "add") {
    const blocks = [...state.present.blocks];
    blocks.splice(action.atIndex ?? blocks.length, 0, action.block);
    return record(state, { ...state.present, blocks });
  }
  const index = state.present.blocks.findIndex((block) => block.id === action.id);
  if (index < 0) return state;
  if (action.type === "update") {
    const blocks = state.present.blocks.map((block) => {
      if (block.id !== action.id) return block;
      const { sourceHtml: _sourceHtml, ...editableBlock } = block;
      return { ...editableBlock, ...action.patch } as EmailBuilderBlock;
    });
    return record(state, { ...state.present, blocks });
  }
  if (action.type === "move") {
    const blocks = [...state.present.blocks];
    const [block] = blocks.splice(index, 1);
    if (!block) return state;
    blocks.splice(Math.max(0, Math.min(action.toIndex, blocks.length)), 0, block);
    return record(state, { ...state.present, blocks });
  }
  if (action.type === "duplicate") {
    const source = state.present.blocks[index];
    if (!source) return state;
    const blocks = [...state.present.blocks];
    blocks.splice(index + 1, 0, { ...structuredClone(source), id: action.newId });
    return record(state, { ...state.present, blocks });
  }
  if (state.present.blocks.length === 1) return state;
  return record(state, { ...state.present, blocks: state.present.blocks.filter((block) => block.id !== action.id) });
}
