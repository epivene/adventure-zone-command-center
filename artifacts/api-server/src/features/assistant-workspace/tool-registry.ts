import type { ToolRegistry } from "./contracts";
import { blocked } from "./read-tools";
const taskTools = new Set([
  "read_profile",
  "read_profile_history",
  "list_documents",
  "read_document",
  "read_rules",
  "research_profile_task",
  "prepare_profile_task_change",
  "list_saved_research",
  "read_saved_research",
  "update_profile",
  "add_profile_note",
  "record_profile_task_outcome",
  "get_profile_task",
]);
export function createToolRegistry(registries: ToolRegistry[]): ToolRegistry {
  return {
    definitions(context) {
      return registries
        .flatMap((r) => r.definitions(context))
        .filter(
          (d) => !context.taskId || taskTools.has((d as { name: string }).name),
        );
    },
    async execute(context, call) {
      if (context.taskId && !taskTools.has(call.name))
        return blocked("ASSISTANT_TARGET_NOT_IN_BATCH");
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
