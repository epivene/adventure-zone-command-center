import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { ensureLeadIntakeSchemaBeforeListen } from "./lead-intake-required-startup";

describe("lead email startup readiness", () => {
  it("adds shared template and visual-builder columns before seeding even when lead intake is already current", async () => {
    let bodyFormatExists = false;
    let editorDocumentExists = false;
    let editorDocumentVersionExists = false;
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("ADD COLUMN IF NOT EXISTS body_format")) bodyFormatExists = true;
        if (sql.includes("ADD COLUMN IF NOT EXISTS editor_document jsonb")) editorDocumentExists = true;
        if (sql.includes("ADD COLUMN IF NOT EXISTS editor_document_version integer")) editorDocumentVersionExists = true;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => false,
      ensureTemplateSeed: async () => {
        if (!bodyFormatExists || !editorDocumentExists || !editorDocumentVersionExists) {
          throw new Error("visual template columns do not exist");
        }
      },
      isTemplateReady: async () => true,
    })).resolves.toBe(false);
    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS body_format text NOT NULL DEFAULT 'plain_text'",
    );
    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS editor_document jsonb",
    );
    expect(client.query).toHaveBeenCalledWith(
      "ALTER TABLE communication_templates ADD COLUMN IF NOT EXISTS editor_document_version integer",
    );
  });

  it("does not seed templates if the shared column migration fails", async () => {
    const failure = new Error("column migration failed");
    const seed = vi.fn();
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("ALTER TABLE communication_templates")) throw failure;
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    await expect(ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => false,
      ensureTemplateSeed: seed,
      isTemplateReady: async () => true,
    })).rejects.toThrow("column migration failed");
    expect(seed).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(failure);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:lead-intake-schema'))",
    );
  });

  it("seeds and verifies the exact approved template under the startup lock before releasing it", async () => {
    const order: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        order.push(sql.includes("pg_advisory_unlock") ? "unlock" : sql.includes("pg_advisory_lock") ? "lock" : "query");
        return { rows: [] };
      }),
      release: vi.fn(() => order.push("release")),
    };
    const result = await ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => { order.push("schema"); return true; },
      ensureTemplateSeed: async () => { order.push("seed"); },
      isTemplateReady: async () => { order.push("ready"); return true; },
    });

    expect(result).toBe(true);
    expect(order).toEqual(["lock", "schema", "query", "query", "query", "seed", "ready", "unlock", "release"]);
  });

  it("fails startup when the exact approved template is not ready", async () => {
    const client = { query: vi.fn(async () => ({ rows: [] })), release: vi.fn() };
    await expect(ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => false,
      ensureTemplateSeed: async () => undefined,
      isTemplateReady: async () => false,
      getTemplateReadinessIssues: async () => ["sourceStorageReference"],
    })).rejects.toThrow("mismatched readiness fields: sourceStorageReference");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("destroys its checked-out client when startup is aborted", async () => {
    const controller = new AbortController();
    let rejectLock: ((error: Error) => void) | undefined;
    const client = {
      query: vi.fn(
        () =>
          new Promise<{ rows: Array<Record<string, unknown>> }>((_, reject) => {
            rejectLock = reject;
          }),
      ),
      release: vi.fn((error?: Error | boolean) => {
        if (error instanceof Error) rejectLock?.(error);
      }),
    };

    const startup = ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      signal: controller.signal,
      ensureSchema: async () => false,
      ensureTemplateSeed: async () => undefined,
      isTemplateReady: async () => true,
    });
    await vi.waitFor(() => expect(client.query).toHaveBeenCalledOnce());

    controller.abort(new Error("Startup step timed out: required lead intake schema"));

    await expect(startup).rejects.toThrow("Startup step timed out: required lead intake schema");
    expect(client.release).toHaveBeenCalledWith(expect.any(Error));
    expect(client.release).toHaveBeenCalledOnce();
  });
  it("turns a checked-out client error into a retryable startup rejection", async () => {
    const connectionError = new Error("Connection terminated unexpectedly");
    const events = new EventEmitter();
    const release = vi.fn();
    const client = Object.assign(events, {
      query: vi.fn(async () => ({ rows: [] as Array<Record<string, unknown>> })),
      release,
    });

    const startup = ensureLeadIntakeSchemaBeforeListen({
      pool: { connect: async () => client },
      ensureSchema: async () => {
        expect(client.listenerCount("error")).toBe(1);
        client.emit("error", connectionError);
        return false;
      },
      ensureTemplateSeed: async () => undefined,
      isTemplateReady: async () => true,
    });

    await expect(startup).rejects.toThrow("Connection terminated unexpectedly");
    expect(release).toHaveBeenCalledWith(connectionError);
    expect(client.listenerCount("error")).toBe(0);
  });

});
