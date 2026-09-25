import { beforeEach, afterEach, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { CampaignStore } from "./campaign-store";
import { ConversationStore } from "./conversation-store";
import { emptySelection, type RunContext } from "./contracts";
import { ensureAssistantWorkspaceSchema } from "../../db/assistant-workspace-startup-migration";
let db: PGlite,
  store: CampaignStore,
  conversations: ConversationStore,
  context: RunContext,
  source: string;
beforeEach(async () => {
  db = new PGlite();
  await ensureAssistantWorkspaceSchema(db);
  store = new CampaignStore(drizzle(db), db);
  conversations = new ConversationStore(db);
  const c = await conversations.create("owner", "Campaign");
  source = (
    await conversations.append("owner", c.id, "start", {
      role: "user",
      text: "Save these leads",
    })
  ).id;
  context = {
    actor: { id: "owner", role: "owner", connectionId: null },
    conversationId: c.id,
    runId: randomUUID(),
    selection: emptySelection(),
    grants: [],
    signal: new AbortController().signal,
  };
}, 30000);
afterEach(async () => {
  await db.close();
});
const input = () => ({
  title: "Summer 2027",
  eventYear: 2027,
  criteria: "Selected fair profiles",
  members: Array.from({ length: 3 }, () => ({
    organizationId: randomUUID(),
    contactId: randomUUID(),
    bookingId: null,
  })),
});
it("saves immutable ordered members and replays a page before checking its stale revision", async () => {
  const data = input();
  const batch = await store.create(context, source, data);
  expect(batch?.members).toEqual(data.members);
  const first = await store.next(context, source, {
    batchId: batch.id,
    revision: batch.revision,
    size: 2,
  });
  expect(first.members).toHaveLength(2);
  const retry = await store.next(context, source, {
    batchId: batch.id,
    revision: batch.revision,
    size: 2,
  });
  expect(retry.members).toEqual(first.members);
  const message = await conversations.append(
    "owner",
    context.conversationId,
    "next",
    { role: "user", text: "Next two" },
  );
  const next = await store.next(context, message.id, {
    batchId: batch.id,
    revision: first.batch.revision,
    size: 2,
  });
  expect(next.members).toEqual(data.members.slice(2));
  expect(next.batch.cursor).toBe(3);
});
it("isolates owners, conversations and source user messages", async () => {
  const batch = await store.create(context, source, input());
  expect(batch).not.toBeNull();
  expect(await store.get("other", context.conversationId, batch.id)).toBeNull();
  const other = await conversations.create("owner", "Other");
  expect(await store.get("owner", other.id, batch.id)).toBeNull();
  const foreign = await conversations.append("owner", other.id, "foreign", {
    role: "user",
    text: "Next",
  });
  await expect(
    store.next(context, foreign.id, {
      batchId: batch.id,
      revision: batch.revision,
      size: 2,
    }),
  ).rejects.toThrow("ASSISTANT_SOURCE_MESSAGE_REQUIRED");
  const assistant = await conversations.append(
    "owner",
    context.conversationId,
    "assistant",
    { role: "assistant", text: "Next" },
  );
  await expect(store.create(context, assistant.id, input())).rejects.toThrow(
    "ASSISTANT_SOURCE_MESSAGE_REQUIRED",
  );
});
it("rejects conflicting creation and paging replays, stale revisions and duplicate organizations", async () => {
  const data = input();
  const batch = await store.create(context, source, data);
  expect(batch).not.toBeNull();
  expect((await store.create(context, source, data)).id).toBe(batch.id);
  await expect(
    store.create(context, source, { ...data, members: data.members.slice(1) }),
  ).rejects.toThrow("ASSISTANT_BATCH_CONFLICT");
  await store.next(context, source, {
    batchId: batch.id,
    revision: batch.revision,
    size: 2,
  });
  await expect(
    store.next(context, source, {
      batchId: batch.id,
      revision: batch.revision,
      size: 1,
    }),
  ).rejects.toThrow("ASSISTANT_PAGE_CONFLICT");
  const m = await conversations.append(
    "owner",
    context.conversationId,
    "next",
    { role: "user", text: "Next" },
  );
  await expect(
    store.next(context, m.id, {
      batchId: batch.id,
      revision: batch.revision,
      size: 2,
    }),
  ).rejects.toThrow("ASSISTANT_VERSION_CONFLICT");
  await expect(
    store.create(context, m.id, {
      ...data,
      members: [data.members[0], data.members[0]],
    }),
  ).rejects.toThrow("ASSISTANT_DUPLICATE_BATCH_MEMBER");
});
it("returns original page members even after another page advanced and keeps completed cursor bounded", async () => {
  const batch = await store.create(context, source, input()),
    first = await store.next(context, source, {
      batchId: batch.id,
      revision: 1,
      size: 2,
    }),
    secondMessage = await conversations.append(
      "owner",
      context.conversationId,
      "second",
      { role: "user", text: "Next" },
    ),
    second = await store.next(context, secondMessage.id, {
      batchId: batch.id,
      revision: first.batch.revision,
      size: 2,
    });
  expect(
    (
      await store.next(context, source, {
        batchId: batch.id,
        revision: 1,
        size: 2,
      })
    ).members,
  ).toEqual(first.members);
  const endMessage = await conversations.append(
      "owner",
      context.conversationId,
      "end",
      { role: "user", text: "Next" },
    ),
    end = await store.next(context, endMessage.id, {
      batchId: batch.id,
      revision: second.batch.revision,
      size: 2,
    });
  expect(end.members).toEqual([]);
  expect(end.batch.cursor).toBe(3);
});
