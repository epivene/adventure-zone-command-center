import { and, asc, eq, isNull } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { officeMessages } from "@/db/schema";

type DrizzleDatabase = typeof database;
export type OfficeMessageViewer = "office" | "owner";

export function isOfficeMessageUnreadFor(
  message: { actorKind: string; readByOfficeAt: Date | null; readByOwnerAt: Date | null },
  viewer: OfficeMessageViewer,
) {
  return viewer === "office"
    ? message.actorKind === "owner" && message.readByOfficeAt === null
    : message.actorKind === "office" && message.readByOwnerAt === null;
}

export class DrizzleOfficeMessageRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async list(accountId: string) {
    return this.database.select().from(officeMessages)
      .where(eq(officeMessages.officeAccountId, accountId))
      .orderBy(asc(officeMessages.createdAt), asc(officeMessages.id));
  }

  async send(accountId: string, actorKind: "office" | "owner", body: string) {
    const now = new Date();
    const [message] = await this.database.insert(officeMessages).values({
      officeAccountId: accountId,
      actorKind,
      body: body.trim(),
      readByOfficeAt: actorKind === "office" ? now : null,
      readByOwnerAt: actorKind === "owner" ? now : null,
      createdAt: now,
    }).returning();
    if (!message) throw new Error("Message could not be saved.");
    return message;
  }

  async markRead(accountId: string, viewer: OfficeMessageViewer) {
    const now = new Date();
    if (viewer === "office") {
      await this.database.update(officeMessages).set({ readByOfficeAt: now })
        .where(and(eq(officeMessages.officeAccountId, accountId), eq(officeMessages.actorKind, "owner"), isNull(officeMessages.readByOfficeAt)));
    } else {
      await this.database.update(officeMessages).set({ readByOwnerAt: now })
        .where(and(eq(officeMessages.officeAccountId, accountId), eq(officeMessages.actorKind, "office"), isNull(officeMessages.readByOwnerAt)));
    }
  }

  async unreadCount(accountId: string, viewer: OfficeMessageViewer) {
    const messages = await this.list(accountId);
    return messages.filter((message) => isOfficeMessageUnreadFor(message, viewer)).length;
  }
}
