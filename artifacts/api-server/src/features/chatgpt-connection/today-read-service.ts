import { z } from "zod";
import {
  activeConnection,
  requireConnectionScope,
  ConnectionError,
  inputHash,
  type ConnectionDatabase,
  type ConnectionPrincipal,
} from "./contracts";
import { businessDateKey, BUSINESS_TIME_ZONE } from "../../lib/business-date";
import type { MasterTodayQueue } from "../today/master-work-queue";
export const todayReadInput = z
  .object({
    section: z
      .enum(["needsAttention", "active", "completedToday"])
      .default("needsAttention"),
    profileId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(1000).optional(),
  })
  .strict();
const cursorSchema = z
  .object({
    offset: z.number().int().min(0),
    fingerprint: z.string().length(64),
  })
  .strict();
export class TodayReadService {
  constructor(
    private db: ConnectionDatabase,
    private load: (now: Date) => Promise<MasterTodayQueue>,
    private now = () => new Date(),
  ) {}
  async read(p: ConnectionPrincipal, raw: z.input<typeof todayReadInput>) {
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    const input = todayReadInput.parse(raw),
      checkedAt = this.now();
    const queue = await this.load(checkedAt);
    await activeConnection(this.db, p);
    const rows = queue[input.section]
      .filter(
        (row) => !input.profileId || row.organizationId === input.profileId,
      )
      .map((row) => ({
        ...row,
        dueAt: row.dueAt?.toISOString() ?? null,
        completedAt: row.completedAt?.toISOString() ?? null,
        profileHref: row.organizationId
          ? `/profiles/${row.organizationId}`
          : null,
      }));
    const businessDate = businessDateKey(checkedAt);
    const fingerprint = inputHash({
      section: input.section,
      profileId: input.profileId ?? null,
      businessDate,
      rows,
    });
    let offset = 0;
    if (input.cursor) {
      let cursor: z.infer<typeof cursorSchema>;
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new ConnectionError("TODAY_CURSOR_INVALID", 400);
      }
      if (cursor.fingerprint !== fingerprint)
        throw new ConnectionError("TODAY_QUEUE_CHANGED", 409);
      offset = cursor.offset;
      if (offset > rows.length)
        throw new ConnectionError("TODAY_CURSOR_INVALID", 400);
    }
    const items = rows.slice(offset, offset + input.limit),
      next = offset + items.length;
    return {
      section: input.section,
      businessDate,
      timeZone: BUSINESS_TIME_ZONE,
      checkedAt: checkedAt.toISOString(),
      items,
      total: rows.length,
      nextCursor:
        next < rows.length
          ? Buffer.from(JSON.stringify({ offset: next, fingerprint })).toString(
              "base64url",
            )
          : null,
      limitations: [
        "Current master Today queue data, not visual screen verification. An absent item is not proof of closure; read_email_profile_assignment returns the thread's current state. Operation receipts describe past saves.",
      ],
    };
  }
}
