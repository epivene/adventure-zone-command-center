import { it, expect, vi } from "vitest";
import { createCampaignTools } from "./campaign-tools";
import { createOperationsTools } from "./operations-tools";
import { emptySelection, type RunContext } from "./contracts";
const id = "11111111-1111-4111-8111-111111111111";
const context: RunContext = {
  actor: { id: "owner", role: "owner", connectionId: null },
  conversationId: id,
  runId: id,
  selection: emptySelection(),
  grants: [],
  signal: new AbortController().signal,
};
it("exposes distinct typed owner tools and rejects a foreign saved run before paging", async () => {
  const next = vi.fn(),
    deps: any = {
      ownerId: "owner",
      campaigns: { next },
      runs: {
        get: async () => ({
          conversationId: "other",
          input: { sourceMessageId: id },
        }),
      },
    };
  const campaigns = createCampaignTools(deps),
    operations = createOperationsTools({
      ...deps,
      database: null,
      db: { query: async () => ({ rows: [] }) },
    });
  const definitions = [
    ...campaigns.definitions(context),
    ...operations.definitions(context),
  ] as any[];
  expect(definitions.some((d) => d.name === "next_campaign_page")).toBe(true);
  expect(definitions.some((d) => d.name === "create_office_task")).toBe(true);
  expect(new Set(definitions.map((d) => d.name)).size).toBe(definitions.length);
  expect(
    operations.definitions({
      ...context,
      actor: { ...context.actor, id: "other" },
    }),
  ).toEqual([]);
  const output = await campaigns.execute(context, {
    id: "page",
    name: "next_campaign_page",
    arguments: JSON.stringify({ batchId: id, revision: 1, size: 2 }),
  });
  expect(output.code).toBe("ASSISTANT_RUN_NOT_FOUND");
  expect(next).not.toHaveBeenCalled();
});
