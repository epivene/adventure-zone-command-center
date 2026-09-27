import { z } from "zod";
import { blocked, result } from "./read-tools";
const common = new Set([
  "propose_profile_task",
  "get_profile_task",
  "record_profile_task_outcome",
  "research_profile_task",
  "prepare_profile_task_change",
  "search_profiles",
  "read_profile",
  "select_profiles",
  "read_profile_history",
  "search_email",
  "read_email_thread",
  "read_commercial_records",
  "list_documents",
  "read_document",
  "read_rules",
  "read_templates",
  "read_template",
  "prepare_draft",
  "read_draft",
  "list_drafts",
  "update_draft",
  "list_followups",
  "read_conversation_history",
  "read_conversation_screenshot",
  "list_saved_research",
  "read_saved_research",
]);
type Definition = {
  type: "function";
  name: string;
  description?: string;
  [key: string]: unknown;
};
const functions = (all: unknown[]) =>
  all.filter(
    (d): d is Definition =>
      !!d &&
      typeof d === "object" &&
      (d as Definition).type === "function" &&
      typeof (d as Definition).name === "string",
  );
export function modelToolDefinitions(
  all: unknown[],
  discovered: string[] = [],
) {
  const defs = functions(all),
    enabled = new Set([...common, ...discovered]);
  const hidden = defs.filter((d) => !enabled.has(d.name));
  return [
    ...defs.filter((d) => enabled.has(d.name)),
    ...(hidden.length
      ? [
          {
            type: "function",
            name: "discover_tools",
            strict: true,
            description:
              "Load additional tools when needed. Choose tool names from the enum for campaigns, research, calendars, profile changes, contracts, payments, operations or inspections. Their full argument schemas become available on the next step. Discovery performs no action and grants no permission.",
            parameters: {
              type: "object",
              properties: {
                names: {
                  type: "array",
                  items: { type: "string", enum: hidden.map((d) => d.name) },
                  minItems: 1,
                  maxItems: 8,
                },
              },
              required: ["names"],
              additionalProperties: false,
            },
          },
        ]
      : []),
  ];
}
export function discoverModelTools(all: unknown[], raw: string) {
  try {
    const names = z
      .object({ names: z.array(z.string()).min(1).max(8) })
      .strict()
      .parse(JSON.parse(raw)).names;
    const defs = functions(all),
      allowed = new Map(defs.map((d) => [d.name, d]));
    if (names.some((name) => !allowed.has(name)))
      return { names: [], output: blocked("ASSISTANT_TOOL_UNKNOWN") };
    return {
      names: [...new Set(names)],
      output: result({
        availableTools: [...new Set(names)].map((name) => ({
          name,
          description: allowed.get(name)!.description,
        })),
      }),
    };
  } catch {
    return { names: [], output: blocked("ASSISTANT_ARGUMENTS_INVALID") };
  }
}
