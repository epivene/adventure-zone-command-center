import { afterEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { KnowledgeRepository } from "./knowledge";
import manifest from "../../../../../imports/assistant-knowledge/2026-09-24-approved-rules.json";
import { readWorkspaceReadiness } from "./readiness";
import { createWorkspaceStartup } from "./startup";

const env = {
  ASSISTANT_WORKSPACE_ENABLED: "true",
  ASSISTANT_WORKSPACE_ACTOR_IDS: "owner",
  ASSISTANT_OPENAI_MODEL: "model-a",
  OPENAI_API_KEY: "secret-do-not-return",
  GOOGLE_WORKSPACE_CLIENT_ID: "id",
  GOOGLE_WORKSPACE_CLIENT_SECRET: "oauth-secret",
  GOOGLE_WORKSPACE_REDIRECT_URI:
    "https://example.test/api/google-workspace/oauth/callback",
  GOOGLE_WORKSPACE_APP_ORIGIN: "https://example.test",
  GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
};
let db: PGlite;
afterEach(async () => {
  if (db && !db.closed) await db.close();
});
async function fixture() {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  const knowledge = new KnowledgeRepository(db);
  for (const rule of manifest.rules) {
    const proposal = await knowledge.propose("owner", rule);
    await knowledge.approve("owner", proposal.id, 0);
  }
  return {
    env,
    actorId: "owner",
    db,
    startup: "ready" as const,
    google: { getCurrent: async () => null, getByRole: async () => null },
  };
}
it("reports local readiness without claiming provider verification or requiring optional Google", async () => {
  const status = await readWorkspaceReadiness(await fixture());
  expect(status.ready).toBe(true);
  expect(status.providerVerification).toBe("not_checked");
  expect(status.checks.find((c) => c.id === "gmail")?.state).toBe(
    "needs_setup",
  );
  expect(JSON.stringify(status)).not.toContain("secret-do-not-return");
});
it("identifies missing keys, invalid limits and the actual owner's excluded access without echoing input", async () => {
  const f = await fixture();
  const status = await readWorkspaceReadiness({
    ...f,
    env: {
      ...env,
      ASSISTANT_WORKSPACE_ENABLED: "false",
      ASSISTANT_WORKSPACE_ACTOR_IDS: "someone-private",
      OPENAI_API_KEY: "",
      ASSISTANT_MAX_STEPS: "credential-in-error",
      ASSISTANT_OPENAI_MODELS: "model-a,invalid value",
    },
  });
  expect(status.ready).toBe(false);
  expect(status.checks.find((c) => c.id === "configuration")?.keys).toEqual(
    expect.arrayContaining([
      "OPENAI_API_KEY",
      "ASSISTANT_MAX_STEPS",
      "ASSISTANT_OPENAI_MODELS",
    ]),
  );
  expect(status.checks.find((c) => c.id === "owner")?.state).toBe(
    "needs_setup",
  );
  expect(JSON.stringify(status)).not.toMatch(
    /someone-private|credential-in-error|invalid value/,
  );
});
it.each([
  "DROP TABLE assistant_workspace_document_extractions",
  "ALTER TABLE assistant_workspace_conversations DROP COLUMN summary",
  "DROP INDEX assistant_workspace_one_active_run_idx",
  "UPDATE assistant_workspace_rules SET status='proposed'",
])("detects incomplete schema or rules: %s", async (mutation) => {
  const f = await fixture();
  await db.exec(mutation);
  const status = await readWorkspaceReadiness(f);
  expect(status.ready).toBe(false);
  expect(status.checks.find((c) => c.id === "database")?.state).toBe(
    "needs_setup",
  );
});
it("sanitizes database failures and keeps optional connection errors independent of core readiness", async () => {
  const f = await fixture();
  const google = {
    getCurrent: async () => {
      throw new Error("refresh-token-secret");
    },
    getByRole: async () => {
      throw new Error("refresh-token-secret");
    },
  };
  const optional = await readWorkspaceReadiness({ ...f, google });
  expect(optional.ready).toBe(true);
  expect(JSON.stringify(optional)).not.toContain("refresh-token-secret");
  const failed = await readWorkspaceReadiness({
    ...f,
    db: {
      query: async () => {
        throw new Error("postgres://private-password");
      },
    },
  });
  expect(failed.ready).toBe(false);
  expect(failed.checks.find((c) => c.id === "database")?.state).toBe(
    "unavailable",
  );
  expect(JSON.stringify(failed)).not.toContain("private-password");
});
it("does not open workspace routes during startup even with a complete database", async () => {
  expect(
    (
      await readWorkspaceReadiness({
        ...(await fixture()),
        startup: "starting",
      })
    ).ready,
  ).toBe(false);
});
it("does not start a worker after failed initialization and reports only safe lifecycle states", async () => {
  const startup = createWorkspaceStartup();
  let started = false;
  await expect(
    startup.initialize(async () => {
      throw new Error("database-password");
    }),
  ).rejects.toThrow("database-password");
  startup.start(() => {
    started = true;
    return () => {};
  });
  expect(started).toBe(false);
  expect(startup.state()).toBe("failed");
});
it("becomes ready only after initialization and worker start, and closes on stop or construction failure", async () => {
  const startup = createWorkspaceStartup();
  await startup.initialize(async () => {});
  expect(startup.state()).toBe("starting");
  const stop = startup.start(() => () => {});
  expect(startup.state()).toBe("ready");
  stop();
  expect(startup.state()).toBe("stopped");
  const broken = createWorkspaceStartup();
  await broken.initialize(async () => {});
  expect(() =>
    broken.start(() => {
      throw new Error("storage-secret");
    }),
  ).toThrow();
  expect(broken.state()).toBe("failed");
});
