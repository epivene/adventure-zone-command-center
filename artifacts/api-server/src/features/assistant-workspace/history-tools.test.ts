import { it, expect, vi } from "vitest";
import { createHistoryTools } from "./history-tools";
import { emptySelection, type RunContext } from "./contracts";
const context: RunContext = {
  actor: { id: "owner", role: "owner", connectionId: null },
  conversationId: "c",
  runId: "r",
  selection: emptySelection(),
  grants: [],
  signal: new AbortController().signal,
};
it("derives cutoff from the owned run and rejects model-supplied scope or malformed cursors", async () => {
  const history = vi.fn(async () => ({
    messages: [],
    complete: true,
    nextBeforeSequence: null,
  }));
  const get = vi.fn(async () => ({
    conversationId: "c",
    input: { sourceMessageId: "canonical" },
  }));
  const tools = createHistoryTools({
    ownerId: "owner",
    conversations: { history } as any,
    runs: { get } as any,
  });
  const call = {
    id: "call",
    name: "read_conversation_history",
    arguments: JSON.stringify({ beforeSequence: null, query: "deposit" }),
  };
  expect((await tools.execute(context, call)).status).toBe("ok");
  expect(history).toHaveBeenCalledWith("owner", "c", "canonical", {
    beforeSequence: null,
    query: "deposit",
  });
  for (const args of [
    { beforeSequence: -1, query: null },
    { beforeSequence: null, query: null, sourceMessageId: "future" },
  ])
    expect(
      (
        await tools.execute(context, {
          ...call,
          arguments: JSON.stringify(args),
        })
      ).code,
    ).toBe("ASSISTANT_ARGUMENTS_INVALID");
  expect(
    (await tools.execute({ ...context, conversationId: "other" }, call)).code,
  ).toBe("ASSISTANT_RUN_NOT_FOUND");
  expect(
    (
      await tools.execute(
        { ...context, actor: { ...context.actor, id: "other" } },
        call,
      )
    ).code,
  ).toBe("ASSISTANT_ACCESS_DENIED");
  expect(history).toHaveBeenCalledTimes(1);
});
