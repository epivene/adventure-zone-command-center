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
import { sourceSchema } from "./lead-note-service";
import { profileFields as fields, profileValuesSchema as valuesSchema, profileDetails, profileValueShape } from "./profile-fields";
export const saveProfileInput = z.object({
  profileId: z.string().uuid(), expectedRevision: z.string().min(1).max(100),
  values: z.object(profileValueShape).strict().refine(v => Object.values(v).some(x => x !== undefined)),
  reason: z.string().trim().min(1).max(1000),
  sources: z.array(sourceSchema).min(1).max(20),
}).strict();
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
  async save(
    p: ConnectionPrincipal, key: MutationKey, raw: unknown,
  ) {
    requireConnectionScope(p, "crm:update");
    const parsed = saveProfileInput.safeParse(raw);
    if (!parsed.success) throw new ConnectionError("CONNECTION_INVALID_PROFILE_FIELDS");
    const input = parsed.data;
    const entries = Object.entries(input.values).filter((entry): entry is [string, string | null] => entry[1] !== undefined);
    // Standing edit consent does not authorize clearing saved information.
    if (entries.some(([, value]) => value == null || value.trim() === ""))
      throw new ConnectionError("CONNECTION_PROFILE_DELETION_APPROVAL_REQUIRED", 403,
        "Removing saved information requires an owner-approved profile proposal.");
    if (/chatgpt|openai|\bAI\b/i.test(input.reason) ||
        (typeof input.values.about === "string" && /chatgpt|openai|\bAI\b/i.test(input.values.about)))
      throw new ConnectionError("CONNECTION_INVALID_PROFILE_FIELDS", 400,
        "Keep profile text and edit reasons plain, without provider references.");
    return this.operations.perform(p, "save_profile_update", key, input, async tx => {
      const row = await profileRow(tx, input.profileId, true);
      if (row.revision !== input.expectedRevision)
        throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      const details = profileDetails(row);
      const changes = entries.filter(([field, value]) => (row[fields[field as keyof typeof fields]] ?? null) !== value);
      if (!changes.length)
        return receipt(tx, row.id, details.href, row.revision, { ...details, changed: false });
      if (changes.some(([field]) => field !== "about") && !input.sources.some(source => source.verification === "verified"))
        throw new ConnectionError("CONNECTION_VERIFIED_SOURCE_REQUIRED");
      const newWebsite = changes.find(([field]) => field === "website")?.[1];
      if (newWebsite) {
        const target = new URL(newWebsite);
        const sameSite = input.sources.some(source => {
          if (source.verification !== "verified") return false;
          const url = new URL(source.url);
          return url.hostname.toLowerCase().replace(/^www\./, "") === target.hostname.toLowerCase().replace(/^www\./, "")
            && url.port === target.port;
        });
        if (!sameSite) throw new ConnectionError("CONNECTION_WEBSITE_SOURCE_MISMATCH");
      }
      const before = Object.fromEntries(changes.map(([field]) => [field, row[fields[field as keyof typeof fields]] ?? null]));
      const params: unknown[] = [row.id];
      const assignments = changes.map(([field, value]) => {
        params.push(value);
        return fields[field as keyof typeof fields] + "=$" + params.length;
      });
      if (changes.some(([field]) => field === "phone")) {
        params.push(normalizeNorthAmericanPhone(input.values.phone!));
        assignments.push("normalized_phone=$" + params.length);
      }
      await tx.query("UPDATE organizations SET " + assignments.join(",") + ",updated_at=clock_timestamp() WHERE id=$1", params);
      const updated = await profileRow(tx, row.id);
      await tx.query(
        'INSERT INTO audit_entries(entity_type,entity_id,action,"before","after") VALUES(\'organization\',$1,\'update\',$2::jsonb,$3::jsonb)',
        [row.id, JSON.stringify(before), JSON.stringify({
          values: Object.fromEntries(changes), reason: input.reason, sources: input.sources,
          connectionId: p.connectionId, clientId: p.clientId, ownerId: p.ownerId,
          priorRevision: row.revision, revision: updated.revision,
        })],
      );
      return receipt(tx, row.id, details.href, updated.revision, { ...profileDetails(updated), changed: true });
    });
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
