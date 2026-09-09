import { db as defaultDatabase, pool as defaultPool } from "@workspace/db";
import { ensureLeadIntakeSchema } from "./lead-intake-startup-migration";
import {
  ensureCommunicationTemplateSeed,
  getApprovedCommunicationTemplateSeedIssues,
  isApprovedCommunicationTemplateSeedReady,
} from "../features/communication-templates/communication-template-seed";

type Client = {
  query(sql: string): Promise<{ rows: Array<Record<string, unknown>> }>;
  release(error?: Error | boolean): void;
  on?(event: "error", listener: (error: Error) => void): unknown;
  off?(event: "error", listener: (error: Error) => void): unknown;
};
type Pool = { connect(): Promise<Client> };

function getAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Lead intake startup was aborted");
}

export async function ensureLeadIntakeSchemaBeforeListen(options?: {
  pool?: Pool;
  signal?: AbortSignal;
  ensureSchema?: (client: Client) => Promise<boolean>;
  ensureTemplateSeed?: () => Promise<void>;
  isTemplateReady?: () => Promise<boolean>;
  getTemplateReadinessIssues?: () => Promise<readonly string[]>;
}): Promise<boolean> {
  const pool = options?.pool ?? (defaultPool as unknown as Pool);
  const client = await pool.connect();
  let locked = false;
  let released = false;
  let connectionError: Error | null = null;
  let operationError: Error | null = null;
  const onClientError = (error: Error) => {
    connectionError = error;
  };
  client.on?.("error", onClientError);
  const throwIfConnectionFailed = () => {
    if (connectionError) throw connectionError;
  };
  const release = (error?: Error) => {
    if (released) return;
    released = true;
    client.release(error);
  };
  const abort = () => release(getAbortError(options!.signal!));

  if (options?.signal?.aborted) {
    const error = getAbortError(options.signal);
    release(error);
    throw error;
  }
  options?.signal?.addEventListener("abort", abort, { once: true });

  try {
    await client.query("SELECT pg_advisory_lock(hashtext('adventure-zone:lead-intake-schema'))");
    throwIfConnectionFailed();
    locked = true;
    const schemaChanged = await (options?.ensureSchema ?? ensureLeadIntakeSchema)(client);
    throwIfConnectionFailed();
    await (options?.ensureTemplateSeed ?? (() => ensureCommunicationTemplateSeed(defaultDatabase as never)))();
    throwIfConnectionFailed();
    const templateReady = await (options?.isTemplateReady ?? (() => isApprovedCommunicationTemplateSeedReady(defaultDatabase as never)))();
    throwIfConnectionFailed();
    if (!templateReady) {
      const issues = options?.getTemplateReadinessIssues
        ? await options.getTemplateReadinessIssues()
        : options?.isTemplateReady
          ? ["approvedTemplateFields"]
          : await getApprovedCommunicationTemplateSeedIssues(defaultDatabase as never);
      throw new Error(`The approved lead email template is incomplete after startup seeding; mismatched readiness fields: ${issues.join(", ") || "unknown"}. Startup stopped to protect email review.`);
    }
    return schemaChanged;
  } catch (error) {
    if (error instanceof Error) operationError = error;
    throw error;
  } finally {
    options?.signal?.removeEventListener("abort", abort);
    if (!released) {
      if (locked && !connectionError) {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('adventure-zone:lead-intake-schema'))",
        ).catch(() => undefined);
      }
      release(connectionError ?? operationError ?? undefined);
    }
    client.off?.("error", onClientError);
  }
}
