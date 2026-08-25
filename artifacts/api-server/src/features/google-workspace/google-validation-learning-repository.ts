import { pool as defaultPool } from "@workspace/db";

type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlPool = { query(text: string, values?: unknown[]): Promise<QueryResult> };

export type GoogleLearnedProfileTarget = { id: string; name: string };

export type GoogleValidationLearningSnapshot = {
  mailboxEmails: Set<string>;
  threadTargets: Map<string, GoogleLearnedProfileTarget>;
  addressTargets: Map<string, GoogleLearnedProfileTarget>;
};

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function extractEmails(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(matches.map(normalizeEmail))];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

type ThreadRow = {
  threadId: string;
  organization: GoogleLearnedProfileTarget;
  manual: boolean;
};

function learnedThreadTargets(rows: ThreadRow[]): Map<string, GoogleLearnedProfileTarget> {
  const byThread = new Map<string, ThreadRow[]>();
  for (const row of rows) {
    const current = byThread.get(row.threadId) ?? [];
    current.push(row);
    byThread.set(row.threadId, current);
  }

  const output = new Map<string, GoogleLearnedProfileTarget>();
  for (const [threadId, candidates] of byThread) {
    const manual = candidates.filter((candidate) => candidate.manual);
    const pool = manual.length ? manual : candidates;
    const unique = new Map(pool.map((candidate) => [candidate.organization.id, candidate.organization]));
    if (unique.size === 1) output.set(threadId, [...unique.values()][0]);
  }
  return output;
}

function learnedAddressTargets(input: {
  rows: Array<Record<string, unknown>>;
  mailboxEmails: Set<string>;
}): Map<string, GoogleLearnedProfileTarget> {
  const candidates = new Map<string, Map<string, GoogleLearnedProfileTarget>>();

  for (const row of input.rows) {
    if (
      typeof row.resolved_organization_id !== "string" ||
      typeof row.organization_name !== "string"
    ) {
      continue;
    }
    const organization = {
      id: row.resolved_organization_id,
      name: row.organization_name,
    };
    const addresses = [
      ...extractEmails(row.from_header),
      ...extractEmails(row.to_header),
    ];
    for (const address of addresses) {
      if (input.mailboxEmails.has(address)) continue;
      const current = candidates.get(address) ?? new Map<string, GoogleLearnedProfileTarget>();
      current.set(organization.id, organization);
      candidates.set(address, current);
    }
  }

  const output = new Map<string, GoogleLearnedProfileTarget>();
  for (const [address, organizations] of candidates) {
    if (organizations.size === 1) output.set(address, [...organizations.values()][0]);
  }
  return output;
}

export class GoogleValidationLearningRepository {
  constructor(private readonly pool: SqlPool = defaultPool as unknown as SqlPool) {}

  async load(): Promise<GoogleValidationLearningSnapshot> {
    const connection = await this.pool.query(
      `SELECT id, account_email
         FROM google_workspace_connections
        WHERE status IN ('connected', 'reauthorization_required')
        ORDER BY updated_at DESC
        LIMIT 1`,
    );
    const row = connection.rows[0];
    const connectionId = typeof row?.id === "string" ? row.id : null;
    if (!connectionId) {
      return {
        mailboxEmails: new Set<string>(),
        threadTargets: new Map(),
        addressTargets: new Map(),
      };
    }

    const mailboxEmails = new Set<string>();
    if (typeof row.account_email === "string" && row.account_email.trim()) {
      mailboxEmails.add(normalizeEmail(row.account_email));
    }

    const [mappingResult, reviewResult] = await Promise.all([
      this.pool.query(
        `SELECT m.thread_id,
                m.organization_id,
                o.name AS organization_name,
                m.evidence_codes,
                s.validation_status
           FROM google_workspace_validation_mappings m
           JOIN organizations o
             ON o.id = m.organization_id
            AND o.consolidated_into_id IS NULL
           LEFT JOIN google_workspace_validation_state s
             ON s.connection_id = m.connection_id
          WHERE m.connection_id = $1
            AND (
              m.evidence_codes ? 'manual_profile_assignment'
              OR s.validation_status = 'approved'
            )`,
        [connectionId],
      ),
      this.pool.query(
        `SELECT r.from_header,
                r.to_header,
                r.resolved_organization_id,
                o.name AS organization_name
           FROM google_workspace_validation_review_items r
           JOIN organizations o
             ON o.id = r.resolved_organization_id
            AND o.consolidated_into_id IS NULL
          WHERE r.connection_id = $1
            AND r.review_state = 'resolved'
            AND r.resolved_organization_id IS NOT NULL`,
        [connectionId],
      ),
    ]);

    const threadRows: ThreadRow[] = mappingResult.rows.flatMap((entry) => {
      if (
        typeof entry.thread_id !== "string" ||
        typeof entry.organization_id !== "string" ||
        typeof entry.organization_name !== "string"
      ) {
        return [];
      }
      return [{
        threadId: entry.thread_id,
        organization: {
          id: entry.organization_id,
          name: entry.organization_name,
        },
        manual: stringArray(entry.evidence_codes).includes("manual_profile_assignment"),
      }];
    });

    return {
      mailboxEmails,
      threadTargets: learnedThreadTargets(threadRows),
      addressTargets: learnedAddressTargets({
        rows: reviewResult.rows,
        mailboxEmails,
      }),
    };
  }
}
