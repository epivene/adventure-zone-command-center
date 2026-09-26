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
it("reports the current scope head separately from historical rule versions", async () => {
  const first = await knowledge.propose("owner", input);
  expect(first.headVersion).toBe(0);
  expect(first.version).toBeNull();
  const approved = await knowledge.approve("owner", first.id, 0);
  expect(approved).toMatchObject({ version: 1, headVersion: 1 });
  const next = await knowledge.propose("owner", { ...input, body: "Updated" });
  expect(next.headVersion).toBe(1);
  await knowledge.approve("owner", next.id, 1);
  expect(
    (await knowledge.history()).find((rule) => rule.id === first.id),
  ).toMatchObject({
    version: 1,
    headVersion: 2,
    status: "superseded",
  });
});
it("stops using a saved rule while retaining its approval and revision history", async () => {
  const proposal = await knowledge.propose("owner", input);
  const approved = await knowledge.approve("owner", proposal.id, 0);
  const retired = await knowledge.retire("owner", approved.id, 1);
  expect(retired).toMatchObject({
    id: approved.id,
    body: approved.body,
    version: 1,
    headVersion: 2,
    status: "superseded",
    approvedBy: "owner",
    reviewedAt: approved.reviewedAt,
  });
  expect(
    await knowledge.list({
      organizationId: null,
      eventYear: 2027,
      at: "2026-09-24",
    }),
  ).toEqual([]);
  expect(await knowledge.history()).toEqual([retired]);
  expect(
    (
      await db.query(
        "SELECT version,current_id FROM assistant_workspace_rule_heads",
      )
    ).rows,
  ).toEqual([{ version: 2, current_id: null }]);
});
it("rejects stale approvals and repeat retirements after a rule is stopped", async () => {
  const first = await knowledge.propose("owner", input);
  await knowledge.approve("owner", first.id, 0);
  const pending = await knowledge.propose("owner", {
    ...input,
    body: "Pending correction",
  });
  await knowledge.retire("owner", first.id, 1);
  await expect(knowledge.approve("owner", pending.id, 1)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  await expect(knowledge.retire("owner", first.id, 1)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  await expect(knowledge.retire("owner", first.id, 2)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  await expect(knowledge.approve("owner", first.id, 2)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  expect(
    (await knowledge.history()).find((rule) => rule.id === pending.id),
  ).toMatchObject({
    status: "proposed",
    headVersion: 2,
  });
  expect(
    await knowledge.list({
      organizationId: null,
      eventYear: 2027,
      at: "2026-09-24",
    }),
  ).toEqual([]);
});
it("requires fresh approval to save new information after a rule is stopped", async () => {
  const first = await knowledge.propose("owner", input);
  await knowledge.approve("owner", first.id, 0);
  await knowledge.retire("owner", first.id, 1);
  const next = await knowledge.propose("owner", {
    ...input,
    body: "New reviewed information",
  });
  expect(next.headVersion).toBe(2);
  expect(
    await knowledge.list({
      organizationId: null,
      eventYear: 2027,
      at: "2026-09-24",
    }),
  ).toEqual([]);
  const approved = await knowledge.approve("owner", next.id, next.headVersion!);
  expect(approved).toMatchObject({
    version: 3,
    headVersion: 3,
    status: "approved",
  });
  expect(
    (
      await knowledge.list({
        organizationId: null,
        eventYear: 2027,
        at: "2026-09-24",
      })
    ).map((rule) => rule.id),
  ).toEqual([next.id]);
  await expect(knowledge.retire("owner", first.id, 3)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
});
it("cannot stop a proposed rule, an unknown rule, or a newer saved revision", async () => {
  const first = await knowledge.propose("owner", input);
  await expect(knowledge.retire("owner", first.id, 0)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  await expect(
    knowledge.retire("owner", "11111111-1111-4111-8111-111111111111", 0),
  ).rejects.toThrow("ASSISTANT_RULE_VERSION_CONFLICT");
  await knowledge.approve("owner", first.id, 0);
  const next = await knowledge.propose("owner", {
    ...input,
    body: "Correction",
  });
  await knowledge.approve("owner", next.id, 1);
  await expect(knowledge.retire("owner", first.id, 1)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  await expect(knowledge.retire("owner", next.id, 1)).rejects.toThrow(
    "ASSISTANT_RULE_VERSION_CONFLICT",
  );
  expect(
    (
      await knowledge.list({
        organizationId: null,
        eventYear: 2027,
        at: "2026-09-24",
      })
    ).map((rule) => rule.id),
  ).toEqual([next.id]);
});
it("requires an actor and an integer head version to stop using saved information", async () => {
  const proposal = await knowledge.propose("owner", input);
  await knowledge.approve("owner", proposal.id, 0);
  for (const [actor, version] of [
    ["", 1],
    ["owner", -1],
    ["owner", 0.5],
  ] as const) {
    await expect(knowledge.retire(actor, proposal.id, version)).rejects.toThrow(
      "ASSISTANT_ACCESS_DENIED",
    );
  }
  expect((await knowledge.history())[0]).toMatchObject({
    status: "approved",
    headVersion: 1,
  });
});
it("stops only the chosen customer and year scope", async () => {
  const customer = "11111111-1111-4111-8111-111111111111";
  const global = await knowledge.propose("owner", input);
  const current = await knowledge.propose("owner", {
    ...input,
    organizationId: customer,
    eventYear: 2027,
  });
  const future = await knowledge.propose("owner", {
    ...input,
    organizationId: customer,
    eventYear: 2028,
  });
  for (const rule of [global, current, future])
    await knowledge.approve("owner", rule.id, 0);
  await knowledge.retire("owner", current.id, 1);
  expect(
    (
      await knowledge.list({
        organizationId: customer,
        eventYear: 2027,
        at: "2026-09-24",
      })
    ).map((rule) => rule.id),
  ).toEqual([global.id]);
  expect(
    (
      await knowledge.list({
        organizationId: customer,
        eventYear: 2028,
        at: "2026-09-24",
      })
    ).map((rule) => rule.id),
  ).toEqual([global.id, future.id]);
  expect(
    (await knowledge.history()).find((rule) => rule.id === future.id),
  ).toMatchObject({ status: "approved", headVersion: 1 });
});
it("does not generalize customer/year exceptions", async () => {
  const p = "11111111-1111-4111-8111-111111111111";
  const exception = await knowledge.propose("owner", {
    ...input,
    organizationId: p,
    eventYear: 2027,
    effectiveTo: "2026-09-30",
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
  for (const at of ["2026-09-21", "2026-10-01"]) {
    expect(
      await knowledge.list({ organizationId: p, eventYear: 2027, at }),
    ).toEqual([]);
  }
});

it("normalizes the real PostgreSQL DATE parser result", async () => {
  const { types } = await import("pg");
  expect(ruleDate(types.getTypeParser(1082)("2026-09-24") as any)).toBe(
    "2026-09-24",
  );
});
