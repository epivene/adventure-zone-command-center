import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db, pool } from "@/db/client";
import { CommunicationRepository } from "./communication-repository";

const LEG_A = "00000000-0000-4000-8000-0000000000a1";
const LEG_B = "00000000-0000-4000-8000-0000000000b2";
const LEG_C = "00000000-0000-4000-8000-0000000000c3";

const repo = new CommunicationRepository(db);

beforeAll(async () => {
  await repo.ensureSchema();
  await db.execute(sql.raw("truncate manager_admin_message_reads, manager_message_reads, manager_message_attachments, manager_messages, manager_conversation_members, manager_conversations cascade"));
});

afterAll(async () => {
  await pool.end();
});

describe("CommunicationRepository", () => {
  it("shows the all-managers channel to every manager and admin", async () => {
    const conversation = await repo.createConversation({ kind: "all_managers", title: "All Managers", memberLegIds: [] });
    expect((await repo.listForManager(LEG_A)).map((row) => row.id)).toContain(conversation.id);
    expect((await repo.listForManager(LEG_B)).map((row) => row.id)).toContain(conversation.id);
    expect((await repo.listAllForAdmin()).map((row) => row.id)).toContain(conversation.id);
  });

  it("limits leg/direct/group threads to participants while admin can see all", async () => {
    const legThread = await repo.createConversation({ kind: "leg_admin", title: "Leg A + Admin", memberLegIds: [LEG_A] });
    const direct = await repo.createConversation({ kind: "direct", title: "Leg A + Leg B", memberLegIds: [LEG_A, LEG_B] });
    const group = await repo.createConversation({ kind: "group", title: "Swap planning", memberLegIds: [LEG_A, LEG_B] });

    const legA = (await repo.listForManager(LEG_A)).map((row) => row.id);
    const legC = (await repo.listForManager(LEG_C)).map((row) => row.id);
    const admin = (await repo.listAllForAdmin()).map((row) => row.id);

    expect(legA).toEqual(expect.arrayContaining([legThread.id, direct.id, group.id]));
    expect(legC).not.toEqual(expect.arrayContaining([legThread.id, direct.id, group.id]));
    expect(admin).toEqual(expect.arrayContaining([legThread.id, direct.id, group.id]));
  });

  it("deduplicates retried messages by actor and client mutation id", async () => {
    const conversation = await repo.createConversation({ kind: "direct", title: null, memberLegIds: [LEG_A, LEG_B] });
    const input = {
      conversationId: conversation.id,
      actor: { kind: "manager" as const, legId: LEG_A, name: "Kristy" },
      body: "Meet halfway?",
      clientMutationId: "00000000-0000-4000-8000-00000000d001",
    };
    const first = await repo.sendMessage(input);
    const second = await repo.sendMessage(input);
    expect(second.id).toBe(first.id);
    expect(await repo.getMessages(conversation.id, { kind: "admin", name: "Admin" })).toHaveLength(1);
  });

  it("tracks unread messages per manager and clears them when read", async () => {
    const conversation = await repo.createConversation({ kind: "direct", title: null, memberLegIds: [LEG_A, LEG_B] });
    await repo.sendMessage({
      conversationId: conversation.id,
      actor: { kind: "manager", legId: LEG_A, name: "Kristy" },
      body: "Trailer is ready.",
      clientMutationId: "00000000-0000-4000-8000-00000000d002",
    });
    expect((await repo.listForManager(LEG_B)).find((row) => row.id === conversation.id)?.unreadCount).toBe(1);
    await repo.markConversationRead(conversation.id, LEG_B);
    expect((await repo.listForManager(LEG_B)).find((row) => row.id === conversation.id)?.unreadCount).toBe(0);
  });

  it("tracks manager replies as unread for Admin until Admin opens the conversation", async () => {
    const conversation = await repo.createConversation({ kind: "leg_admin", title: "Leg A + Admin", memberLegIds: [LEG_A] });
    await repo.sendMessage({
      conversationId: conversation.id,
      actor: { kind: "admin", name: "Admin" },
      body: "How did setup go?",
      clientMutationId: "00000000-0000-4000-8000-00000000d003",
    });
    await repo.markConversationReadForAdmin(conversation.id);

    await repo.sendMessage({
      conversationId: conversation.id,
      actor: { kind: "manager", legId: LEG_A, name: "Kristy" },
      body: "Setup went well.",
      clientMutationId: "00000000-0000-4000-8000-00000000d004",
    });

    expect((await repo.listAllForAdmin()).find((row) => row.id === conversation.id)?.unreadCount).toBe(1);
    await repo.markConversationReadForAdmin(conversation.id);
    expect((await repo.listAllForAdmin()).find((row) => row.id === conversation.id)?.unreadCount).toBe(0);
  });
});
