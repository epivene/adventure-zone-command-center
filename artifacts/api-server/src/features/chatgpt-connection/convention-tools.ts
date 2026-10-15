import { z } from "zod";
import {
  ConventionRepository,
  type QueryClient,
} from "../convention-outreach/repository";
import {
  groups,
  outcomes,
  attendanceKinds,
} from "../convention-outreach/policy";
import {
  activeConnection,
  requireConnectionScope,
  transaction,
  inputHash,
  type ConnectionDatabase,
  type ConnectionPrincipal,
} from "./contracts";
const text = z.string().trim().max(12000);
export const conventionMemberInput = z
  .object({
    sourceKey: z.string().trim().min(1).max(300),
    event: z.string().trim().min(1).max(500),
    contact: z.string().max(500).optional(),
    email: z.string().max(500).optional(),
    group: z.enum(groups).optional(),
    outcome: z.enum(outcomes).optional(),
    attendance: z.enum(attendanceKinds).optional(),
    notes: text.optional(),
    reason: text.optional(),
    sources: text.min(1),
    nextAction: text.optional(),
    research: z.record(z.string().max(200), text).optional(),
    conventionResponse: z
      .object({
        met: z.boolean(),
        interested: z.boolean(),
        followUp: z.boolean(),
        contact: z.string().max(500),
        notes: text,
      })
      .strict()
      .optional(),
  })
  .strict();
export const conventionPreviewInput = z
  .object({
    editionId: z.string().uuid(),
    rows: z.array(conventionMemberInput).min(1).max(100),
  })
  .strict();
export const conventionAddInput = conventionPreviewInput
  .extend({
    expectedRevision: z.number().int().positive(),
    requestKey: z.string().trim().min(1).max(200),
  })
  .strict();
export class ConnectionConventionService {
  constructor(private db: ConnectionDatabase) {}
  private repository(p: ConnectionPrincipal, write = false) {
    const db = this.db;
    // Repository transactions run on the connector's pinned client. The grant is
    // rechecked and locked in the same transaction as the roster write/audit.
    return new (class extends ConventionRepository {
      constructor() {
        super({
          query: (sql, values) => db.query(sql, values),
          connect: async () => {
            throw new Error("Use connector transaction");
          },
        });
      }
      override async transaction<T>(
        work: (client: QueryClient) => Promise<T>,
      ): Promise<T> {
        return transaction(db, async (tx) => {
          requireConnectionScope(p, "crm:read");
          if (write) requireConnectionScope(p, "crm:append");
          await activeConnection(tx, p, true);
          return work(tx);
        });
      }
    })();
  }
  async preview(p: ConnectionPrincipal, raw: unknown) {
    const input = conventionPreviewInput.parse(raw);
    requireConnectionScope(p, "crm:read");
    await activeConnection(this.db, p);
    return {
      editionId: input.editionId,
      ...(await this.repository(p).preview(input.editionId, input.rows)),
      instruction:
        "Review saved convention editions/members and matching profiles first. Membership is not confirmed attendance or a booking. Reuse stable sourceKey values. Save with the returned revision; existing source keys are retained unchanged.",
    };
  }
  async add(p: ConnectionPrincipal, raw: unknown) {
    const input = conventionAddInput.parse(raw);
    requireConnectionScope(p, "crm:read");
    requireConnectionScope(p, "crm:append");
    await activeConnection(this.db, p);
    const hash = inputHash([
      p.ownerId,
      p.connectionId,
      "convention-add",
      input.requestKey,
    ]);
    const key = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const result = await this.repository(p, true).import(
      input.editionId,
      input.rows,
      input.expectedRevision,
      key,
      `owner:${p.ownerId}:chatgpt:${p.connectionId}`,
    );
    return {
      operationId: key,
      recordId: input.editionId,
      ...result,
      verified: true,
      instruction:
        "Committed convention import with convention_history audit. added counts new rows; retained counts existing source keys left unchanged. Read convention_members through list_app_records/read_app_record to inspect saved content. No outreach sent or booking/leg assignment changed.",
    };
  }
}
export function conventionTools(
  service: ConnectionConventionService | undefined,
  p: ConnectionPrincipal,
) {
  if (!service) return [];
  return [
    {
      name: "preview_convention_additions",
      scope: "crm:read" as const,
      readOnly: true,
      description:
        "Preview additions to the convention plan/roster. Read convention_editions and convention_members using list_app_records/read_app_record first, and check Boss submissions and profile history. Returns exact revision and conservative profile matches. No changes; unknown attendance stays unknown.",
      schema: conventionPreviewInput,
      call: (a: unknown) => service.preview(p, a),
    },
    {
      name: "add_convention_members",
      scope: "crm:append" as const,
      readOnly: false,
      destructive: false,
      description:
        "Save owner-requested additions to the convention plan/roster after preview, using expectedRevision and a stable requestKey. Requires crm:read and crm:append. Reuse sourceKey and identical requestKey on retries. Existing rows are retained, not overwritten. Returns committed audit operationId and added/retained counts. Does not approve for Dave, send messages, confirm attendance, or change bookings/capacity.",
      schema: conventionAddInput,
      call: (a: unknown) => service.add(p, a),
    },
  ];
}
