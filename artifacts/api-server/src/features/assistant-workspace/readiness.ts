import type { Queryable } from "./contracts";
import { readModelConfig } from "./model-config";
import type { WorkspaceStartupState } from "./startup";
import type { GoogleConnectionView } from "../google-workspace/google-connection-repository";
import { getGoogleWorkspaceEnvironment } from "../google-workspace/google-workspace-env";
import { createPrivateStorageOptionsFromEnv } from "../../lib/private-object-storage";
import manifest from "../../../../../imports/assistant-knowledge/2026-09-24-approved-rules.json" with { type: "json" };

export type ReadinessCheck = {
  id: string;
  label: string;
  state: "ready" | "needs_setup" | "unavailable" | "not_checked";
  required: boolean;
  message: string;
  keys?: string[];
  href?: string;
};
type Dependencies = {
  env: Record<string, string | undefined>;
  actorId: string;
  db: Queryable;
  startup: WorkspaceStartupState;
  google: {
    getCurrent(): Promise<GoogleConnectionView | null>;
    getByRole(
      role: "operational_calendar",
    ): Promise<GoogleConnectionView | null>;
  };
};
const tables = [
  "conversations",
  "messages",
  "actions",
  "runs",
  "events",
  "rule_heads",
  "rules",
  "drafts",
  "mutation_results",
  "send_reviews",
  "campaign_batches",
  "campaign_pages",
  "research_calls",
  "document_extractions",
  "screenshots",
].map((name) => `assistant_workspace_${name}`);
const additions = [
  "assistant_workspace_messages.attachments",
  "assistant_workspace_conversations.summary",
  "assistant_workspace_conversations.version",
  "assistant_workspace_conversations.lifecycle",
  "assistant_workspace_document_extractions.call_id",
  "assistant_workspace_campaign_batches.draft_links",
  "assistant_workspace_research_calls.input_fingerprint",
];
const requiredTriggers = [
  "assistant_workspace_conversations.assistant_workspace_guard_lifecycle",
  ...[
    "messages",
    "runs",
    "actions",
    "drafts",
    "screenshots",
    "send_reviews",
  ].map(
    (table) =>
      `assistant_workspace_${table}.assistant_workspace_${table}_new_work`,
  ),
];
const googleKeys = [
  "GOOGLE_WORKSPACE_CLIENT_ID",
  "GOOGLE_WORKSPACE_CLIENT_SECRET",
  "GOOGLE_WORKSPACE_REDIRECT_URI",
  "GOOGLE_WORKSPACE_APP_ORIGIN",
  "GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY",
];
async function databaseReady(db: Queryable) {
  const columns = await db.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=ANY($1::text[])`,
    [tables],
  );
  const present = new Set(columns.rows.map((r) => r.table_name));
  const fields = new Set(
    columns.rows.map((r) => `${r.table_name}.${r.column_name}`),
  );
  if (
    tables.some((t) => !present.has(t)) ||
    additions.some((c) => !fields.has(c))
  )
    return false;
  const index = await db.query(
    `SELECT i.indisunique, i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND c.relname='assistant_workspace_one_active_run_idx'`,
  );
  if (!index.rows.some((r) => r.indisunique && r.indisvalid)) return false;
  const triggers = await db.query(
    `SELECT c.relname AS table_name,t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')`,
  );
  const enabledTriggers = new Set(
    triggers.rows.map((r) => `${r.table_name}.${r.tgname}`),
  );
  if (requiredTriggers.some((trigger) => !enabledTriggers.has(trigger)))
    return false;
  const rules = await db.query(
    `SELECT DISTINCT r.rule_key FROM assistant_workspace_rules r JOIN assistant_workspace_rule_heads h ON h.scope_key=r.scope_key
     WHERE r.organization_id IS NULL AND r.event_year IS NULL AND (
       (r.status='approved' AND h.current_id=r.id AND r.effective_from<=CURRENT_DATE AND (r.effective_to IS NULL OR r.effective_to>=CURRENT_DATE))
       OR (h.current_id IS NULL AND r.status='superseded' AND r.version>0 AND h.version=r.version+1 AND r.approved_by IS NOT NULL AND r.reviewed_at IS NOT NULL)
     )`,
  );
  // An intentional retirement retains reviewed initialization evidence. Never
  // turn the workspace off or reinstall a rule solely because its owner stopped it.
  const initialized = new Set(rules.rows.map((r) => r.rule_key));
  return manifest.rules.every((r) => initialized.has(r.ruleKey));
}
export async function readWorkspaceReadiness(deps: Dependencies) {
  const { env, actorId } = deps;
  const config = readModelConfig(env);
  const checks: ReadinessCheck[] = [
    {
      id: "activation",
      label: "Workspace activation",
      state:
        env.ASSISTANT_WORKSPACE_ENABLED === "true" ? "ready" : "needs_setup",
      required: true,
      message:
        env.ASSISTANT_WORKSPACE_ENABLED === "true"
          ? "Workspace is enabled on the server."
          : "Enable the workspace on the API service after completing setup.",
      keys: ["ASSISTANT_WORKSPACE_ENABLED"],
    },
    {
      id: "configuration",
      label: "OpenAI configuration",
      state: config.error ? "needs_setup" : "ready",
      required: true,
      message: config.error
        ? "Add or correct these API service environment settings."
        : "A key, model and valid usage limits are configured.",
      keys: config.configurationIssues,
    },
    {
      id: "owner",
      label: "Owner access",
      state: config.allowedActorIds.includes(actorId) ? "ready" : "needs_setup",
      required: true,
      message: config.allowedActorIds.includes(actorId)
        ? "Your signed-in owner account has access."
        : "Include owner in the API service's assistant access list.",
      keys: ["ASSISTANT_WORKSPACE_ACTOR_IDS"],
    },
  ];
  try {
    const ready = await databaseReady(deps.db);
    checks.push({
      id: "database",
      label: "Saved workspace and business rules",
      required: true,
      state: ready ? "ready" : "needs_setup",
      message: ready
        ? "Required storage and reviewed business-rule setup are present."
        : "Workspace storage or initial business rules need initialization. Deploy the latest API and check its assistant startup logs.",
    });
  } catch {
    checks.push({
      id: "database",
      label: "Saved workspace and business rules",
      required: true,
      state: "unavailable",
      message:
        "Database readiness could not be checked. Check the API service logs, then refresh.",
    });
  }
  checks.push({
    id: "startup",
    label: "Assistant worker",
    required: true,
    state:
      deps.startup === "ready"
        ? "ready"
        : deps.startup === "failed"
          ? "unavailable"
          : "needs_setup",
    message:
      deps.startup === "ready"
        ? "Workspace initialization completed and its worker started."
        : deps.startup === "failed"
          ? "Assistant startup failed. Check the API service logs and restart after correcting setup."
          : "The assistant worker has not started. Complete setup and allow API startup to finish.",
  });
  checks.push({
    id: "openai",
    label: "OpenAI access",
    required: false,
    state: "not_checked",
    message:
      "Key validity, model access and billing have not been tested. This status check makes no OpenAI requests.",
  });
  let googleConfigured = false;
  try {
    googleConfigured = getGoogleWorkspaceEnvironment(env).configured;
  } catch {
    /* fixed messages only */
  }
  for (const [id, label, read, scopes] of [
    [
      "gmail",
      "Company Gmail",
      () => deps.google.getCurrent(),
      [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://mail.google.com/",
      ],
    ],
    [
      "calendar",
      "Operational calendar",
      () => deps.google.getByRole("operational_calendar"),
      ["https://www.googleapis.com/auth/calendar"],
    ],
  ] as const) {
    let connected = false,
      unavailable = false;
    if (googleConfigured) {
      try {
        const c = await read();
        connected =
          c?.status === "connected" &&
          scopes.some((scope) => c.grantedScopes.includes(scope));
      } catch {
        unavailable = true;
      }
    }
    checks.push({
      id,
      label,
      required: false,
      state: unavailable ? "unavailable" : connected ? "ready" : "needs_setup",
      message: connected
        ? "A connection with the required read scope is saved. Live Google access has not been tested; writes require their own scopes and review."
        : unavailable
          ? "Saved connection status could not be read. Check Google settings."
          : "Connect or reconnect this account in Google settings. Chat remains available without it.",
      href: "/settings/google-workspace",
      ...(!googleConfigured ? { keys: googleKeys } : {}),
    });
  }
  let storage = false;
  try {
    storage = Boolean(
      createPrivateStorageOptionsFromEnv(env, ["GOOGLE_CLOUD_STORAGE_BUCKET"])
        .bucketName,
    );
  } catch {
    /* no credential details */
  }
  checks.push({
    id: "documents",
    label: "Private documents",
    required: false,
    state: storage ? "not_checked" : "needs_setup",
    message: storage
      ? "Storage settings are present. File access and credentials have not been tested."
      : "Configure private file storage to read and export stored documents.",
    keys: ["GOOGLE_CLOUD_STORAGE_BUCKET", "GOOGLE_SERVICE_ACCOUNT_JSON"],
  });
  checks.push({
    id: "sending",
    label: "Reviewed email sending",
    required: false,
    state:
      env.OUTREACH_PLANNER_ENABLED === "true" ? "not_checked" : "needs_setup",
    message:
      "Sending also requires the outreach planner, Gmail write permissions and a valid reviewed send. No email is sent by setup checks.",
    keys: ["OUTREACH_PLANNER_ENABLED"],
    href: "/settings/google-workspace",
  });
  checks.push({
    id: "contracts",
    label: "Contract creation",
    required: false,
    state:
      env.CONTRACT_BUILDER_ENABLED === "true" ? "not_checked" : "needs_setup",
    message:
      "Contract creation requires the contract builder and an active approved template.",
    keys: ["CONTRACT_BUILDER_ENABLED"],
  });
  return {
    enabled: config.enabled,
    ready:
      config.enabled &&
      checks.filter((c) => c.required).every((c) => c.state === "ready"),
    model: config.models.includes(config.model) ? config.model : null,
    models: config.models,
    error: config.error,
    maxSteps: config.maxSteps,
    maxRunTokens: config.maxRunTokens,
    providerVerification: "not_checked" as const,
    checks,
  };
}
