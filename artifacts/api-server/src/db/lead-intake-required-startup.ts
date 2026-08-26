import { db as defaultDatabase, pool as defaultPool } from "@workspace/db";
import { ensureLeadIntakeSchema } from "./lead-intake-startup-migration";
import {
  ensureCommunicationTemplateSeed,
  getApprovedCommunicationTemplateSeedIssues,
  isApprovedCommunicationTemplateSeedReady,
} from "../features/communication-templates/communication-template-seed";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(): void;
};
type Pool = { connect(): Promise<Client> };

export async function ensureLeadIntakeSchemaBeforeListen(options?: {
  pool?: Pool;
  ensureSchema?: (client: Client) => Promise<boolean>;
  ensureTemplateSeed?: () => Promise<void>;
  isTemplateReady?: () => Promise<boolean>;
  getTemplateReadinessIssues?: () => Promise<readonly string[]>;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('adventure-zone:lead-intake-schema'))");
    locked = true;
    const schemaChanged = await (options?.ensureSchema ?? ensureLeadIntakeSchema)(client);
    await (options?.ensureTemplateSeed ?? (() => ensureCommunicationTemplateSeed(defaultDatabase as never)))();
    const templateReady = await (options?.isTemplateReady ?? (() => isApprovedCommunicationTemplateSeedReady(defaultDatabase as never)))();
    if (!templateReady) {
      const issues = options?.getTemplateReadinessIssues
        ? await options.getTemplateReadinessIssues()
        : options?.isTemplateReady
          ? ["approvedTemplateFields"]
          : await getApprovedCommunicationTemplateSeedIssues(defaultDatabase as never);
      throw new Error(`The approved lead email template is incomplete after startup seeding; mismatched readiness fields: ${issues.join(", ") || "unknown"}. Startup stopped to protect email review.`);
    }
    return schemaChanged;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('adventure-zone:lead-intake-schema'))").catch(() => undefined);
    client.release();
  }
}
