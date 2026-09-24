import { it, expect, vi } from "vitest";
import { createWorkspaceTools } from "./workspace-tools";
import { emptySelection, type RunContext } from "./contracts";
const id = "11111111-1111-4111-8111-111111111111";
const context: RunContext = {
  actor: { id: "owner", role: "owner", connectionId: null },
  conversationId: "chat",
  runId: "run",
  selection: { ...emptySelection(), organizationIds: [id] },
  grants: [],
  signal: new AbortController().signal,
};
it("loads the actual saved draft and revision on a later turn, confined to its conversation", async () => {
  const draft = {
    id,
    conversationId: "chat",
    revision: "edited-revision",
    content: { organizationId: id, html: "<p>40% deposit</p>" },
  };
  const drafts = { get: vi.fn().mockResolvedValue(draft) };
  const tools = createWorkspaceTools({ ownerId: "owner", drafts } as any);
  const call = {
    id: "call",
    name: "read_draft",
    arguments: JSON.stringify({ draftId: id }),
  };
  expect((await tools.execute(context, call)).data).toEqual(draft);
  drafts.get.mockResolvedValue({ ...draft, conversationId: "other" });
  expect((await tools.execute(context, call)).status).toBe("blocked");
});

it("refreshes customer/year rules and clears old draft and booking when year changes", async () => {
  const prior = {
    ...emptySelection(),
    organizationIds: [id],
    eventYear: 2027,
    draftId: id,
    bookingId: id,
  };
  const local = { ...context, selection: { ...prior } };
  const rule = {
    id: "rule",
    rule_key: "customer-terms",
    body: "Customer-specific terms",
    source_label: "Owner",
    organization_id: id,
    event_year: 2028,
    effective_from: "2026-09-24",
    effective_to: null,
    version: 1,
    status: "approved",
  };
  const db = {
    query: vi.fn(async (sql: string) => ({
      rows: sql.includes("FROM organizations") ? [{ id }] : [rule],
    })),
  };
  const conversations = {
    get: vi.fn().mockResolvedValue({ version: 1, selection: prior }),
    setSelection: vi.fn(async (_a, _c, _v, selection) => ({ selection })),
  };
  const tools = createWorkspaceTools({
    ownerId: "owner",
    db,
    conversations,
  } as any);
  const out = await tools.execute(local, {
    id: "select",
    name: "select_profiles",
    arguments: JSON.stringify({ organizationIds: [id], eventYear: 2028 }),
  });
  expect(out.status).toBe("ok");
  expect(out.evidence[0]).toMatchObject({ kind: "rule", eventYear: 2028 });
  expect(local.selection).toMatchObject({
    eventYear: 2028,
    draftId: null,
    bookingId: null,
  });
});
