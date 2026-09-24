import { it, expect } from "vitest";
import { assertActionAccess } from "./access";
import { readModelConfig } from "./model-config";
it("blocks a switched account", () => {
  expect(() =>
    assertActionAccess({
      actor: { id: "a", role: "owner", connectionId: "new" },
      ownerId: "a",
      requiredConnectionId: "old",
    }),
  ).toThrow("ASSISTANT_CONNECTION_CHANGED");
});
it("blocks another actor", () => {
  expect(() =>
    assertActionAccess({
      actor: { id: "a", role: "owner", connectionId: null },
      ownerId: "b",
      requiredConnectionId: null,
    }),
  ).toThrow("ASSISTANT_ACCESS_DENIED");
});
it("keeps the new assistant off with incomplete configuration", () => {
  expect(
    readModelConfig({
      ASSISTANT_WORKSPACE_ENABLED: "true",
      ANTHROPIC_API_KEY: "not-openai",
    }).enabled,
  ).toBe(false);
});
it("uses only explicitly configured OpenAI and bounded settings", () => {
  const c = readModelConfig({
    ASSISTANT_WORKSPACE_ENABLED: "true",
    ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
    ASSISTANT_OPENAI_MODEL: "configured-model",
    OPENAI_API_KEY: "test",
    ASSISTANT_MAX_STEPS: "99999",
  });
  expect(c.enabled).toBe(false);
  const valid = readModelConfig({
    ASSISTANT_WORKSPACE_ENABLED: "true",
    ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
    ASSISTANT_OPENAI_MODEL: "configured-model",
    OPENAI_API_KEY: "test",
  });
  expect(valid.enabled).toBe(true);
  expect(valid.model).toBe("configured-model");
});
