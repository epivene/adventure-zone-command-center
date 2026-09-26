import { beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { Conversation, Draft } from "./types";
const persistence = vi.hoisted(() => ({ record: null as any }));
vi.mock("./offline-db", () => ({
  readOfflineRecord: async () => structuredClone(persistence.record),
  changeOfflineRecord: async (change: any) => {
    const result = change(structuredClone(persistence.record));
    persistence.record = structuredClone(result.record);
    return result.value;
  },
}));
import {
  getOfflineBinding,
  commitPreparedSnapshot,
  loadOfflineWorkspace,
  offlineDraftVersion,
  saveOfflineDraft,
  updateOfflineDraft,
} from "./offline-store";
import { syncOfflineDraft } from "./offline-sync";
const initial: Draft = {
  id: "d1",
  revision: "r1",
  status: "local",
  gmailDraftId: null,
  content: {
    to: ["a@example.com"],
    cc: [],
    subject: "Original",
    html: "<p>Hello</p>",
    text: "Hello",
    threadId: "thread",
    attachmentIds: ["attachment"],
    templateId: "template",
    templateVersion: "v1",
  },
};
const edits = {
  subject: "Phone edit",
  html: "<p>Changed</p>",
  text: "Changed",
};
const conversation: Conversation = {
  id: "c1",
  title: "Fair",
  version: 1,
  selection: {
    organizationIds: [],
    bookingId: null,
    threadId: null,
    draftId: null,
    eventYear: null,
  },
  messages: [],
  actions: [],
  drafts: [initial],
  runs: [],
};
let server: Draft,
  patches: unknown[],
  loseResponse: boolean,
  failReads: boolean;
let beforeResponse: () => Promise<void>;
const saved = async () => (await loadOfflineWorkspace()).snapshots[0].drafts[0];
beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  persistence.record = null;
  server = structuredClone(initial);
  patches = [];
  loseResponse = false;
  failReads = false;
  beforeResponse = async () => {};
  localStorage.setItem("az_owner_token", `owner.${Date.now() + 86400000}.sig`);
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (
      url.endsWith("/conversations/c1") &&
      (!init.method || init.method === "GET")
    ) {
      if (failReads) throw new Error("Disconnected");
      return new Response(
        JSON.stringify({ ...conversation, drafts: [server] }),
      );
    }
    if (url.endsWith("/drafts/d1") && init.method === "PATCH") {
      const body = JSON.parse(init.body as string);
      patches.push(body);
      if (body.revision !== server.revision)
        return new Response(
          JSON.stringify({ code: "ASSISTANT_DRAFT_VERSION_CONFLICT" }),
          { status: 409 },
        );
      server = {
        ...server,
        revision: "r2",
        content: {
          ...server.content,
          subject: body.subject,
          html: body.html,
          text: body.text,
        },
      };
      failReads = true;
      if (loseResponse) throw new Error("Connection lost after server saved");
      const response = new Response(JSON.stringify(server));
      await beforeResponse();
      return response;
    }
    throw new Error(`Unexpected network action ${init.method ?? "GET"} ${url}`);
  });
  await commitPreparedSnapshot(await getOfflineBinding(), {
    conversation,
    profiles: [],
    rules: [],
  });
  await saveOfflineDraft("c1", "d1", edits, offlineDraftVersion(await saved()));
});
it("syncs only the explicit subject/body revision patch and advances local revision without another server read", async () => {
  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "synced",
  });
  expect(patches).toEqual([{ revision: "r1", ...edits }]);
  expect(await saved()).toMatchObject({
    base: {
      revision: "r2",
      content: { to: ["a@example.com"], attachmentIds: ["attachment"] },
    },
    local: null,
    syncState: "idle",
  });
});
it("preserves both versions without a mutation when the server changed", async () => {
  server = {
    ...server,
    revision: "other",
    content: { ...server.content, subject: "Someone else" },
  };
  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "conflict",
  });
  expect(patches).toEqual([]);
  expect(await saved()).toMatchObject({
    base: { revision: "r1" },
    local: edits,
    conflict: { revision: "other" },
  });
});
it("reconciles a lost response from current server state without repeating the patch", async () => {
  loseResponse = true;
  await expect(syncOfflineDraft("c1", "d1")).rejects.toThrow(/lost/i);
  expect(await saved()).toMatchObject({ local: edits, syncState: "uncertain" });
  failReads = false;
  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "synced",
  });
  expect(patches).toHaveLength(1);
  expect(await saved()).toMatchObject({
    base: { revision: "r2" },
    local: null,
  });
});
it("does not overwrite later server changes after a lost response", async () => {
  loseResponse = true;
  await expect(syncOfflineDraft("c1", "d1")).rejects.toThrow();
  server = {
    ...server,
    revision: "r3",
    content: { ...server.content, subject: "Later online edit" },
  };
  failReads = false;
  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "conflict",
  });
  expect(patches).toHaveLength(1);
  expect(await saved()).toMatchObject({
    local: edits,
    conflict: { revision: "r3" },
  });
});
it("refuses to treat matching text with changed recipients as a reconciled save", async () => {
  loseResponse = true;
  await expect(syncOfflineDraft("c1", "d1")).rejects.toThrow();
  server = {
    ...server,
    revision: "r3",
    content: { ...server.content, to: ["other@example.com"] },
  };
  failReads = false;
  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "conflict",
  });
  expect(patches).toHaveLength(1);
  expect((await saved()).local).toEqual(edits);
});

it("does not downgrade a newer completed sync when an older response arrives late", async () => {
  beforeResponse = async () => {
    await updateOfflineDraft("c1", "d1", (current) => ({
      ...current,
      base: {
        ...server,
        revision: "r3",
        content: { ...server.content, subject: "Newer tab save" },
      },
      local: null,
      attempt: null,
      conflict: null,
      syncState: "idle",
    }));
  };
  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    draft: { base: { revision: "r3" } },
  });
  expect(await saved()).toMatchObject({
    base: { revision: "r3", content: { subject: "Newer tab save" } },
    local: null,
  });
});

it("does not attach a late read conflict after another tab already settled that revision", async () => {
  server = {
    ...initial,
    revision: "r2",
    content: { ...initial.content, ...edits },
  };
  vi.stubGlobal("fetch", async () => {
    await updateOfflineDraft("c1", "d1", (current) => ({
      ...current,
      base: server,
      local: null,
      attempt: null,
      conflict: null,
      syncState: "idle",
    }));
    return new Response(JSON.stringify({ ...conversation, drafts: [server] }));
  });

  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "synced",
    draft: { base: { revision: "r2" }, local: null, conflict: null },
  });
  expect((await saved()).conflict).toBeNull();
});

it("reconciles a matching accepted attempt after a competing PATCH returns a conflict", async () => {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (init.method === "PATCH") {
      patches.push(JSON.parse(init.body as string));
      server = {
        ...server,
        revision: "r2",
        content: { ...server.content, ...edits },
      };
      return new Response(
        JSON.stringify({ code: "ASSISTANT_DRAFT_VERSION_CONFLICT" }),
        { status: 409 },
      );
    }
    return new Response(JSON.stringify({ ...conversation, drafts: [server] }));
  });

  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "synced",
    draft: {
      base: { revision: "r2" },
      local: null,
      conflict: null,
      attempt: null,
      syncState: "idle",
    },
  });
  expect(patches).toHaveLength(1);
});

it("does not attach a late PATCH conflict after another tab settles the same revision", async () => {
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (init.method === "PATCH") {
      server = {
        ...server,
        revision: "r2",
        content: { ...server.content, ...edits },
      };
      await updateOfflineDraft("c1", "d1", (current) => ({
        ...current,
        base: server,
        local: null,
        attempt: null,
        conflict: null,
        syncState: "idle",
      }));
      return new Response(
        JSON.stringify({ code: "ASSISTANT_DRAFT_VERSION_CONFLICT" }),
        { status: 409 },
      );
    }
    return new Response(JSON.stringify({ ...conversation, drafts: [server] }));
  });

  expect(await syncOfflineDraft("c1", "d1")).toMatchObject({
    status: "synced",
    draft: { base: { revision: "r2" }, local: null, conflict: null },
  });
  expect((await saved()).conflict).toBeNull();
});

it("preserves newer unsynced work when a late PATCH conflict belongs to an older attempt", async () => {
  const newerEdits = { ...edits, subject: "Newer device edits" };
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    if (init.method === "PATCH") {
      server = {
        ...server,
        revision: "r2",
        content: { ...server.content, subject: "Changed elsewhere" },
      };
      await updateOfflineDraft("c1", "d1", (current) => ({
        ...current,
        base: { ...server, revision: "r3" },
        local: newerEdits,
        attempt: { revision: "r3", edits: newerEdits },
        conflict: null,
        syncState: "uncertain",
      }));
      return new Response(
        JSON.stringify({ code: "ASSISTANT_DRAFT_VERSION_CONFLICT" }),
        { status: 409 },
      );
    }
    return new Response(JSON.stringify({ ...conversation, drafts: [server] }));
  });

  await expect(syncOfflineDraft("c1", "d1")).rejects.toThrow(/another tab/i);
  expect(await saved()).toMatchObject({
    base: { revision: "r3" },
    local: newerEdits,
    attempt: { revision: "r3", edits: newerEdits },
    conflict: null,
    syncState: "uncertain",
  });
});
