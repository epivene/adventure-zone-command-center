import { beforeEach, afterEach, it, expect } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { KnowledgeRepository, shouldApplySeed, ruleDate } from "./knowledge";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
let db: PGlite, knowledge: KnowledgeRepository;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  knowledge = new KnowledgeRepository(db);
});
afterEach(async () => {
  await db.close();
});
const input = {
  ruleKey: "space",
  body: "10,000–15,000 sq ft",
  sourceLabel: "Desiree, September 22 correction",
  organizationId: null,
  eventYear: null,
  effectiveFrom: "2026-09-22",
  effectiveTo: null,
};
it("preserves a user correction against a seed", () => {
  expect(
    shouldApplySeed({
      currentVersion: 3,
      incomingVersion: 4,
      userEdited: true,
    }),
  ).toBe(false);
});
it("requires approval and keeps superseded history", async () => {
  const first = await knowledge.propose("owner", input);
  expect(
    await knowledge.list({
      organizationId: null,
      eventYear: 2027,
      at: "2026-09-24",
    }),
  ).toEqual([]);
  await knowledge.approve("owner", first.id, 0);
  const next = await knowledge.propose("owner", {
    ...input,
    body: "New correction",
  });
  await knowledge.approve("owner", next.id, 1);
  const active = await knowledge.list({
    organizationId: null,
    eventYear: 2027,
    at: "2026-09-24",
  });
  expect(active.map((x) => x.body)).toEqual(["New correction"]);
  expect(
    (await knowledge.history()).find((x) => x.id === first.id)?.status,
  ).toBe("superseded");
});
it("rejects stale approvals", async () => {
  const a = await knowledge.propose("owner", input);
  const b = await knowledge.propose("owner", { ...input, body: "Different" });
  await knowledge.approve("owner", a.id, 0);
  await expect(knowledge.approve("owner", b.id, 0)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
});
it("does not generalize customer/year exceptions", async () => {
  const p = "11111111-1111-4111-8111-111111111111";
  const exception = await knowledge.propose("owner", {
    ...input,
    organizationId: p,
    eventYear: 2027,
  });
  await knowledge.approve("owner", exception.id, 0);
  expect(
    await knowledge.list({
      organizationId: null,
      eventYear: 2027,
      at: "2026-09-24",
    }),
  ).toEqual([]);
  expect(
    await knowledge.list({
      organizationId: p,
      eventYear: 2028,
      at: "2026-09-24",
    }),
  ).toEqual([]);
  expect(
    await knowledge.list({
      organizationId: p,
      eventYear: 2027,
      at: "2026-09-24",
    }),
  ).toHaveLength(1);
});

it("normalizes the real PostgreSQL DATE parser result", async () => {
  const { types } = await import("pg");
  expect(ruleDate(types.getTypeParser(1082)("2026-09-24") as any)).toBe(
    "2026-09-24",
  );
});
