import { it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { createWorkspaceWorker } from "./worker";
import { emptySelection } from "./contracts";
it("runs beyond the old history limit, checkpoints context before the provider and keeps all originals", async () => {
  const db = new PGlite();
  try {
    await ensureAssistantWorkspaceSchema(db);
    const conversations = new ConversationStore(db),
      runs = new RunStore(db);
    const c = await conversations.create("owner", "Long working conversation");
    for (let n = 0; n < 32; n++)
      await conversations.append("owner", c.id, `old${n}`, {
        role: "user",
        text: `${n}:` + "Old details. ".repeat(1500),
      });
    const run = await runs.submit(
      {
        actor: { id: "owner", role: "owner", connectionId: null },
        conversationId: c.id,
        requestKey: "now",
        selection: emptySelection(),
        grants: [],
      },
      "Latest correction: 2027 only",
    );
    await conversations.append("owner", c.id, "future", {
      role: "user",
      text: "Future message must stay out",
    });
    const fullHistory = vi.spyOn(conversations, "get");
    const next = vi.fn(async (input) => {
      const saved = await runs.get("owner", run.id);
      expect(saved?.turn?.context?.sourceMessageId).toBe(
        run.input.sourceMessageId,
      );
      expect(input.turns).toHaveLength(6);
      expect(input.evidence).toContainEqual(
        expect.objectContaining({ id: "saved-research-index" }),
      );
      expect(input.spendingScope.runId).toBe(run.id);
      expect(input.turns.at(-1).text).toBe("Latest correction: 2027 only");
      expect(input.memory.omittedMessageCount).toBe(3);
      expect(JSON.stringify(input)).not.toContain(
        "Future message must stay out",
      );
      expect(JSON.stringify(input).length).toBeLessThan(200000);
      return {
        text: "Ready to continue",
        calls: [],
        providerItems: [],
        inputTokens: 2,
        outputTokens: 2,
      };
    });
    const worker = createWorkspaceWorker({
      conversations,
      runs,
      model: { next },
      tools: { definitions: () => [], execute: vi.fn() },
      allowedActorIds: ["owner"],
      maxSteps: 4,
      maxTokens: 1000,
      evidence: async () => [],
      historicalEvidence: async (context) => {
        expect(context.conversationId).toBe(c.id);
        return [
          {
            id: "saved-research-index",
            kind: "web",
            recordId: "saved",
            eventYear: null,
            occurredAt: null,
            retrievedAt: new Date().toISOString(),
            version: null,
            complete: false,
            text: "Historical saved research is available; no profile completion claim.",
          },
        ];
      },
    });
    await worker.tick();
    expect(next).toHaveBeenCalledTimes(1);
    expect(fullHistory).not.toHaveBeenCalled();
    expect((await runs.get("owner", run.id))?.status).toBe("succeeded");
    const original = await conversations.get("owner", c.id);
    expect(original?.messages).toHaveLength(35);
    expect(original?.summary).toMatchObject({ totalMessageCount: 33 });
  } finally {
    await db.close();
  }
}, 30000);
