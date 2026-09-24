import type { ToolRegistry } from "./contracts";
import { blocked } from "./read-tools";
export function createToolRegistry(registries: ToolRegistry[]): ToolRegistry {
  return {
    definitions(context) {
      return registries.flatMap((r) => r.definitions(context));
    },
    async execute(context, call) {
      const matches = registries.filter((r) =>
        r
          .definitions(context)
          .some((d) => (d as { name?: string }).name === call.name),
      );
      if (matches.length !== 1) return blocked("ASSISTANT_TOOL_UNKNOWN");
      if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
      return matches[0].execute(context, call);
    },
  };
}
