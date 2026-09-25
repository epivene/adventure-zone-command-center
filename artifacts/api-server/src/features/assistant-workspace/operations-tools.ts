import { z } from "zod";
import type { ToolRegistry, Queryable } from "./contracts";
import type { RunStore } from "./run-store";
import type { ActionExecutor } from "./action-executor";
import { createOperationsReads } from "./operations-reads";
import { operationsActionSchemas } from "./operations-actions";
import { stableCampaignId } from "./campaign-store";
import { blocked } from "./read-tools";
const year = z.number().int().min(2000).max(2200),
  schemas = {
    list_legs: z.object({}).strict(),
    read_route_context: z.object({ legId: z.uuid(), eventYear: year }).strict(),
    read_booking_operations: z
      .object({ bookingId: z.uuid(), eventYear: year })
      .strict(),
    read_resource_inventory: z.object({}).strict(),
    read_inspection_context: z
      .object({ legId: z.uuid(), inspectionYear: year })
      .strict(),
    read_staff_work: z.object({ accountId: z.uuid().nullable() }).strict(),
    ...Object.fromEntries(
      Object.entries(operationsActionSchemas).map(([name, values]) => [
        name,
        z
          .object({
            targetId: z.uuid(),
            expectedRevision: z.string().min(1),
            values,
          })
          .strict(),
      ]),
    ),
  };
export function createOperationsTools(deps: {
  ownerId: string;
  database: any;
  db: Queryable;
  runs: RunStore;
  executor: ActionExecutor;
}): ToolRegistry {
  const reads = createOperationsReads(deps.database, deps.db);
  return {
    definitions(c) {
      if (c.actor.id !== deps.ownerId || c.actor.role !== "owner") return [];
      return Object.entries(schemas).map(([name, schema]) => ({
        type: "function",
        name,
        description: `Perform ${name.replaceAll("_", " ")}. Preserve date, year, assignment and availability uncertainty. Office task changes require current account/task revision and owner review. Read-only operational tools never allocate equipment or complete inspections.`,
        parameters: z.toJSONSchema(schema, { io: "input" }),
        strict: false,
      }));
    },
    async execute(c, call) {
      if (
        c.actor.id !== deps.ownerId ||
        c.actor.role !== "owner" ||
        c.signal.aborted
      )
        return blocked("ASSISTANT_ACCESS_DENIED");
      const schema = schemas[call.name as keyof typeof schemas];
      if (!schema) return blocked("ASSISTANT_TOOL_UNKNOWN");
      let a: any;
      try {
        a = schema.parse(JSON.parse(call.arguments));
      } catch {
        return blocked("ASSISTANT_ARGUMENTS_INVALID");
      }
      try {
        if (call.name in reads) return await (reads as any)[call.name](c, a);
        const run = await deps.runs.get(c.actor.id, c.runId);
        if (!run || run.conversationId !== c.conversationId)
          return blocked("ASSISTANT_RUN_NOT_FOUND");
        return await deps.executor.execute(c, {
          id: stableCampaignId(`${c.runId}:${call.id}`),
          actorId: c.actor.id,
          conversationId: c.conversationId,
          sourceMessageId: run.input.sourceMessageId,
          kind: call.name,
          targetId: a.targetId,
          expectedRevision: a.expectedRevision,
          connectionId: null,
          arguments: a.values,
        });
      } catch (e) {
        return blocked(
          e instanceof Error && e.message.startsWith("ASSISTANT_")
            ? e.message
            : "ASSISTANT_TOOL_FAILED",
        );
      }
    },
  };
}
