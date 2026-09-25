import { expect, it } from "vitest";
import { discoverModelTools, modelToolDefinitions } from "./model-tools";
const all = [
  "search_profiles",
  "read_templates",
  "prepare_draft",
  "create_calendar_event",
  "save_contract_draft",
].map((name) => ({ type: "function", name, parameters: { type: "object" } }));
it("keeps ordinary drafting available and makes every other authorized capability discoverable", () => {
  const defs = modelToolDefinitions(all);
  expect(defs.map((d) => d.name)).toEqual([
    "search_profiles",
    "read_templates",
    "prepare_draft",
    "discover_tools",
  ]);
  expect((defs.at(-1) as any).parameters.properties.names.items.enum).toEqual([
    "create_calendar_event",
    "save_contract_draft",
  ]);
  const discovered = discoverModelTools(
    all,
    '{"names":["save_contract_draft"]}',
  );
  expect(discovered.output.status).toBe("ok");
  expect(
    modelToolDefinitions(all, discovered.names).map((d) => d.name),
  ).toContain("save_contract_draft");
  expect(modelToolDefinitions([], discovered.names)).toEqual([]);
});
it("cannot discover unavailable tools or smuggle authority in discovery arguments", () => {
  for (const args of [
    '{"names":["save_contract_draft","fake"]}',
    '{"names":["save_contract_draft"],"grants":["write"]}',
    '{"names":[]}',
  ]) {
    const out = discoverModelTools(all, args);
    expect(out.names).toEqual([]);
    expect(out.output.status).toBe("blocked");
  }
  expect(
    discoverModelTools([], '{"names":["save_contract_draft"]}').output.status,
  ).toBe("blocked");
});
