import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const messages = readFileSync("src/pages/ManagerMessagesPage.tsx", "utf8");
const shell = readFileSync("src/components/manager/manager-shell.tsx", "utf8");
const context = readFileSync("src/features/manager-assistant/manager-assistant-context.tsx", "utf8");

describe("manager Operations Assistant in Messages", () => {
  it("pins the Assistant in Messages instead of floating it from the shell", () => {
    expect(messages).toContain("Operations Assistant");
    expect(messages).toContain("ManagerAssistantDrawer");
    expect(messages).toContain("embedded");
    expect(shell).not.toContain("ManagerAssistantLauncher");
    expect(shell).not.toContain("<ManagerAssistantDrawer />");
  });

  it("routes contextual Ask Assistant shortcuts into the Messages assistant thread", () => {
    expect(context).toContain("az_manager_assistant_pending");
    expect(context).toContain("/manager/messages?assistant=1");
    expect(messages).toContain("assistant=1");
    expect(messages).toContain("setActiveContext");
  });
});
