import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const workspaceSource = readFileSync("src/pages/CallWorkspacePage.tsx", "utf8");
const finderSource = readFileSync("src/components/calls/caller-finder.tsx", "utf8");
const quickAddSource = readFileSync("src/components/contacts/quick-add-caller.tsx", "utf8");

describe("Calls owns caller creation", () => {
  it("supports add mode with prefilled phone/query values inside CallWorkspacePage", () => {
    expect(workspaceSource).toContain('const addMode = params.get("mode") === "add"');
    expect(workspaceSource).toContain('const initialPhone = params.get("phone") ?? ""');
    expect(workspaceSource).toContain('const initialQuery = params.get("q") ?? ""');
    expect(workspaceSource).toContain("<QuickAddCaller");
    expect(workspaceSource).toContain('apiPost<QuickAddResult>("/calls/quick-caller", input)');
  });

  it("moves the finder Create contact action into Calls add mode", () => {
    expect(finderSource).toContain("/calls/workspace?mode=add");
    expect(finderSource).not.toContain("/quick-add?create=1");
  });

  it("returns created or matched callers directly to the canonical Calls workspace", () => {
    expect(quickAddSource).not.toContain("/calls/new?contactId=");
    expect(quickAddSource).toContain("/calls/workspace?contactId=");
  });
});
