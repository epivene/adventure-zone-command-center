import { afterEach, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
import { ConversationStore } from "./conversation-store";
import { RunStore } from "./run-store";
import { emptySelection } from "./contracts";
import { ScreenshotStore } from "./screenshots";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  "base64",
);
const id = "11111111-1111-4111-8111-111111111111";
let db: PGlite, conversations: ConversationStore, store: ScreenshotStore;
let objects: Map<string, Uint8Array>;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  conversations = new ConversationStore(db);
  objects = new Map();
  store = new ScreenshotStore(db, () => ({
    put: async (key: string, bytes: Uint8Array) => {
      objects.set(key, bytes);
    },
    get: async (key: string) => objects.get(key)!,
  }));
});
afterEach(async () => {
  await db.close();
});
it("keeps existing screenshots readable after trash and blocks new uploads", async () => {
  const c = await conversations.create("owner", "Screenshots remain");
  const original = await store.upload(
    "owner",
    c.id,
    id,
    "screen.png",
    "image/png",
    png,
  );
  await conversations.setLifecycle("owner", c.id, c.version, "trashed");
  expect((await store.read("owner", c.id, id)).attachment).toEqual(original);
  expect(
    await store.upload("owner", c.id, id, "screen.png", "image/png", png),
  ).toEqual(original);
  await expect(
    store.upload(
      "owner",
      c.id,
      "22222222-2222-4222-8222-222222222222",
      "new.png",
      "image/png",
      png,
    ),
  ).rejects.toThrow("ASSISTANT_CONVERSATION_INACTIVE");
  expect(objects.size).toBe(1);
});
it("keeps uploads private, immutable and scoped to their conversation", async () => {
  const c = await conversations.create("owner", "Screen");
  const a = await store.upload(
    "owner",
    c.id,
    id,
    "screen.png",
    "image/png",
    png,
  );
  expect(a).toMatchObject({
    id,
    filename: "screen.png",
    contentType: "image/png",
    byteSize: png.length,
  });
  expect(a).not.toHaveProperty("objectKey");
  expect(
    await store.upload("owner", c.id, id, "screen.png", "image/png", png),
  ).toEqual(a);
  expect(objects.size).toBe(1);
  await expect(
    store.upload("owner", c.id, id, "changed.png", "image/png", png),
  ).rejects.toThrow("CONFLICT");
  await expect(store.metadataForSend("other", c.id, [id])).rejects.toThrow(
    "NOT_FOUND",
  );
  const other = await conversations.create("owner", "Other");
  await expect(store.read("owner", other.id, id)).rejects.toThrow("NOT_FOUND");
});
it("only supplies images bound to messages at or before the owned run source", async () => {
  const c = await conversations.create("owner", "Screen");
  const source = await conversations.append("owner", c.id, "before", {
    role: "user",
    text: "Before image",
  });
  const a = await store.upload(
    "owner",
    c.id,
    id,
    "screen.png",
    "image/png",
    png,
  );
  const runs = new RunStore(db);
  const run = await runs.submit(
    {
      actor: { id: "owner", role: "owner", connectionId: null },
      conversationId: c.id,
      requestKey: "image",
      selection: emptySelection(),
      grants: [],
    },
    "",
    [a],
  );
  const scope = {
    actorId: "owner",
    conversationId: c.id,
    sourceMessageId: run.input.sourceMessageId,
  };
  expect((await store.readForModel(scope, id)).bytes).toEqual(png);
  const history = await conversations.history(
    "owner",
    c.id,
    scope.sourceMessageId,
    { query: "SCREEN.PNG", beforeSequence: null },
  );
  expect(history.messages[0]?.attachments).toEqual([a]);
  const { createScreenshotTools } = await import("./screenshot-tools");
  const tools = createScreenshotTools({
    ownerId: "owner",
    screenshots: store,
    runs,
  });
  const context = {
    actor: { id: "owner", role: "owner" as const, connectionId: null },
    conversationId: c.id,
    runId: run.id,
    selection: emptySelection(),
    grants: [],
    signal: new AbortController().signal,
  };
  const call = {
    id: "read",
    name: "read_conversation_screenshot",
    arguments: JSON.stringify({ screenshotId: id }),
  };
  const result = await tools.execute(context, call);
  expect(result.screenshots).toEqual([a]);
  expect(JSON.stringify(result)).not.toMatch(/object_key|base64|data:image/);
  expect(
    (
      await tools.execute(
        { ...context, actor: { ...context.actor, id: "other" } },
        call,
      )
    ).status,
  ).toBe("blocked");
  await expect(
    store.readForModel({ ...scope, sourceMessageId: source.id }, id),
  ).rejects.toThrow("NOT_FOUND");
  await expect(
    store.readForModel({ ...scope, actorId: "other" }, id),
  ).rejects.toThrow("NOT_FOUND");
  objects.set([...objects.keys()][0], new Uint8Array([0]));
  await expect(store.readForModel(scope, id)).rejects.toThrow("CHANGED");
});
it("rejects unsupported, mismatched, truncated and oversized bytes before storage", async () => {
  const c = await conversations.create("owner", "Screen");
  for (const [mime, bytes] of [
    ["image/svg+xml", Buffer.from("<svg/>")],
    ["image/jpeg", png],
    ["image/png", png.subarray(0, 24)],
    ["image/png", Buffer.alloc(5 * 1024 * 1024 + 1)],
  ] as const) {
    await expect(
      store.upload("owner", c.id, id, "screen", mime, bytes),
    ).rejects.toThrow("ASSISTANT_SCREENSHOT");
  }
  expect(objects.size).toBe(0);
});
it("retries a failed upload into the reserved key even with different UUID case", async () => {
  const c = await conversations.create("owner", "Retry");
  const attachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let fail = true;
  store = new ScreenshotStore(db, () => ({
    put: async (key, bytes) => {
      if (fail) throw new Error("private-storage-token");
      objects.set(key, bytes);
    },
    get: async (key) => objects.get(key)!,
  }));
  await expect(
    store.upload("owner", c.id, attachmentId, "screen.png", "image/png", png),
  ).rejects.toThrow("ASSISTANT_SCREENSHOT_UPLOAD_FAILED");
  await expect(
    store.metadataForSend("owner", c.id, [attachmentId]),
  ).rejects.toThrow("NOT_FOUND");
  fail = false;
  await store.upload(
    "owner",
    c.id.toUpperCase(),
    attachmentId.toUpperCase(),
    "screen.png",
    "image/png",
    png,
  );
  expect((await store.read("owner", c.id, attachmentId)).bytes).toEqual(png);
});
it("keeps unsent images and foreign or assistant source messages out of model reads", async () => {
  const c = await conversations.create("owner", "Screen"),
    other = await conversations.create("owner", "Other");
  const a = await store.upload(
    "owner",
    c.id,
    id,
    "screen.png",
    "image/png",
    png,
  );
  const source = await conversations.append("owner", c.id, "unsent", {
    role: "user",
    text: "No screenshot attached",
  });
  await expect(
    store.metadataForModel(
      { actorId: "owner", conversationId: c.id, sourceMessageId: source.id },
      a.id,
    ),
  ).rejects.toThrow("NOT_FOUND");
  const run = await new RunStore(db).submit(
    {
      actor: { id: "owner", role: "owner", connectionId: null },
      conversationId: c.id,
      requestKey: "image",
      selection: emptySelection(),
      grants: [],
    },
    "",
    [a],
  );
  const foreign = await conversations.append("owner", other.id, "other", {
    role: "user",
    text: "Different chat",
  });
  const assistant = await conversations.append("owner", c.id, "assistant", {
    role: "assistant",
    text: "Done",
  });
  for (const sourceMessageId of [foreign.id, assistant.id])
    await expect(
      store.metadataForModel(
        { actorId: "owner", conversationId: c.id, sourceMessageId },
        a.id,
      ),
    ).rejects.toThrow("NOT_FOUND");
  expect(
    (
      await store.metadataForModel(
        {
          actorId: "owner",
          conversationId: c.id,
          sourceMessageId: run.input.sourceMessageId,
        },
        a.id,
      )
    ).id,
  ).toBe(id);
});
it("rejects corrupt PNG checksums and WebP headers without image payload", async () => {
  const c = await conversations.create("owner", "Screen");
  const brokenPng = Buffer.from(png);
  brokenPng[brokenPng.length - 1] ^= 1;
  const header = Buffer.alloc(30);
  header.write("RIFF");
  header.writeUInt32LE(22, 4);
  header.write("WEBPVP8X", 8);
  header.writeUInt32LE(10, 16);
  for (const [mime, bytes] of [
    ["image/png", brokenPng],
    ["image/webp", header],
  ] as const)
    await expect(
      store.upload("owner", c.id, id, "invalid", mime, bytes),
    ).rejects.toThrow("SCREENSHOT_INVALID");
  expect(objects.size).toBe(0);
});

it.each([
  [
    "image/jpeg",
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z",
  ],
  [
    "image/webp",
    "UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoBAAEAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=",
  ],
])("accepts genuine %s screenshots", async (mime, base64) => {
  const c = await conversations.create("owner", "Formats");
  const bytes = Buffer.from(base64, "base64");
  await store.upload("owner", c.id, id, "screen", mime, bytes);
  expect((await store.read("owner", c.id, id)).bytes).toEqual(bytes);
});
