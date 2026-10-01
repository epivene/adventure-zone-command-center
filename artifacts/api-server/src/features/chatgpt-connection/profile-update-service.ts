import { z } from "zod";
import { randomUUID } from "node:crypto";
import {
  ConnectionError,
  inputHash,
  transaction,
  activeConnection,
  requireConnectionScope,
  type ConnectionDatabase,
  type ConnectionPrincipal,
  type MutationKey,
  type SourceRef,
} from "./contracts";
import { OperationStore } from "./operation-store";
import { profileRow, profileSummary } from "./read-service";
import {
  validateSources,
  receipt,
  insertResearchNote,
} from "./lead-note-service";
import { normalizeNorthAmericanPhone } from "../contacts/phone-normalization";
const fields = {
  phone: "phone",
  website: "website",
  address1: "address_1",
  address2: "address_2",
  city: "city",
  region: "region",
  postalCode: "postal_code",
} as const;
const short = z.string().trim().max(500).nullable();
const valuesSchema = z
  .object({
    phone: short.optional(),
    website: z
      .string()
      .url()
      .max(2048)
      .refine(
        (s) =>
          ["http:", "https:"].includes(new URL(s).protocol) &&
          !new URL(s).username &&
          !new URL(s).password,
      )
      .nullable()
      .optional(),
    address1: short.optional(),
    address2: short.optional(),
    city: short.optional(),
    region: short.optional(),
    postalCode: short.optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
export type UpdateProposal = {
  id: string;
  connectionId: string;
  profileId: string;
  profileName: string;
  revision: string;
  values: Record<string, string | null>;
  oldValues: Record<string, string | null>;
  sources: SourceRef[];
  contentHash: string;
  reviewUrl: string;
};
export class ProfileUpdateService {
  private operations: OperationStore;
  constructor(private db: ConnectionDatabase) {
    this.operations = new OperationStore(db);
  }
  async propose(
    p: ConnectionPrincipal,
    key: MutationKey,
    input: {
      profileId: string;
      expectedRevision: string;
      values: unknown;
      sources: SourceRef[];
    },
  ) {
    requireConnectionScope(p, "crm:update");
    const parsed = valuesSchema.safeParse(input.values);
    if (!parsed.success)
      throw new ConnectionError("CONNECTION_INVALID_PROFILE_FIELDS");
    const sources = validateSources(input.sources),
      values = parsed.data;
    return this.operations.perform(
      p,
      "propose_profile_update",
      key,
      { ...input, values, sources },
      async (tx) => {
        const row = await profileRow(tx, input.profileId, true);
        if (row.revision !== input.expectedRevision)
          throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
        const id = randomUUID(),
          content = {
            id,
            connectionId: p.connectionId,
            profileId: row.id,
            profileName: row.name,
            revision: row.revision,
            values,
            oldValues: Object.fromEntries(
              Object.keys(values).map((k) => [
                k,
                row[fields[k as keyof typeof fields]] ?? null,
              ]),
            ),
            sources,
          };
        const contentHash = inputHash(content);
        await tx.query(
          "INSERT INTO chatgpt_update_proposals(id,connection_id,profile_id,content,content_hash,revision) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id,
            p.connectionId,
            row.id,
            JSON.stringify(content),
            contentHash,
            row.revision,
          ],
        );
        const value: UpdateProposal = {
          ...content,
          contentHash,
          reviewUrl: `/settings/chatgpt-connection?proposal=${id}`,
        };
        return receipt(tx, id, value.reviewUrl, row.revision, value);
      },
    );
  }
  async approve(ownerId: string, proposalId: string, expectedHash: string) {
    return transaction(this.db, async (tx) => {
      const link = (
        await tx.query(
          "SELECT c.* FROM chatgpt_connections c JOIN chatgpt_update_proposals p ON p.connection_id=c.id WHERE p.id=$1 AND c.owner_id=$2",
          [proposalId, ownerId],
        )
      ).rows[0];
      if (!link) throw new ConnectionError("CONNECTION_ACCESS_DENIED", 403);
      await activeConnection(
        tx,
        {
          ownerId,
          connectionId: link.id,
          clientId: link.client_id,
          scopes: ["crm:update"],
        },
        true,
      );
      const row = (
        await tx.query(
          "SELECT * FROM chatgpt_update_proposals WHERE id=$1 FOR UPDATE",
          [proposalId],
        )
      ).rows[0];
      if (row.content?.kind) throw new ConnectionError("CONNECTION_WRONG_PROPOSAL_TYPE", 409);
      if (
        row.consumed_at ||
        row.approved_at ||
        row.content_hash !== expectedHash ||
        inputHash(row.content) !== expectedHash
      )
        throw new ConnectionError("CONNECTION_STALE_PROPOSAL", 409);
      const profile = await profileRow(tx, row.profile_id, true);
      if (profile.revision !== row.revision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      const approvalId = randomUUID();
      await tx.query(
        "UPDATE chatgpt_update_proposals SET approval_id=$2,approved_at=now(),approval_expires_at=now()+interval '15 minutes' WHERE id=$1",
        [proposalId, approvalId],
      );
      return { proposalId, approvalId, expiresInSeconds: 900 };
    });
  }
  async apply(
    p: ConnectionPrincipal,
    key: MutationKey,
    input: { proposalId: string; approvalId: string },
  ) {
    requireConnectionScope(p, "crm:update");
    return this.operations.perform(
      p,
      "apply_approved_profile_update",
      key,
      input,
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT *,approval_expires_at>now() AS unexpired FROM chatgpt_update_proposals WHERE id=$1 AND connection_id=$2 FOR UPDATE",
            [input.proposalId, p.connectionId],
          )
        ).rows[0];
        if (
          !row ||
          row.approval_id !== input.approvalId ||
          !row.approved_at ||
          !row.unexpired ||
          row.consumed_at
        )
          throw new ConnectionError("CONNECTION_APPROVAL_REQUIRED", 403);
        const content = row.content;
        if (content?.kind) throw new ConnectionError("CONNECTION_WRONG_PROPOSAL_TYPE", 409);
        if (
          inputHash(content) !== row.content_hash ||
          content.connectionId !== p.connectionId ||
          content.profileId !== row.profile_id ||
          content.revision !== row.revision
        )
          throw new ConnectionError("CONNECTION_STALE_PROPOSAL", 409);
        const profile = await profileRow(tx, row.profile_id, true);
        if (profile.revision !== row.revision)
          throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
        const values = valuesSchema.parse(content.values);
        const entries = Object.entries(values),
          params: unknown[] = [row.profile_id];
        const assignments = entries.map(([k, v], i) => {
          params.push(v);
          return `${fields[k as keyof typeof fields]}=$${i + 2}`;
        });
        if (Object.hasOwn(values, "phone")) {
          params.push(
            values.phone ? normalizeNorthAmericanPhone(values.phone) : null,
          );
          assignments.push(`normalized_phone=$${params.length}`);
        }
        await tx.query(
          `UPDATE organizations SET ${assignments.join(",")},updated_at=clock_timestamp() WHERE id=$1`,
          params,
        );
        await tx.query(
          "UPDATE chatgpt_update_proposals SET consumed_at=now() WHERE id=$1",
          [row.id],
        );
        await insertResearchNote(
          tx,
          row.profile_id,
          "Owner-approved profile update",
          JSON.stringify({
            proposalId: row.id,
            oldValues: content.oldValues,
            newValues: values,
          }),
          content.sources,
        );
        const result = profileSummary(await profileRow(tx, row.profile_id));
        return receipt(tx, result.id, result.href, result.revision, result);
      },
    );
  }
}
