import type { SyncSql } from "./google-mailbox-sync-repository";
import { mailboxAddress } from "./google-pilot-sync";
export class SyncMatcher {
  constructor(private db: SyncSql) {}
  async candidates(headers: string[], account: string): Promise<string[]> {
    const emails = [
      ...new Set(
        headers
          .flatMap((h) =>
            h.split(/,(?=(?:[^\"]*\"[^\"]*\")*[^\"]*$)/).map(mailboxAddress),
          )
          .filter(
            (a): a is string => Boolean(a) && a !== account.toLowerCase(),
          ),
      ),
    ];
    if (!emails.length) return [];
    return (
      await this.db.query(
        `SELECT DISTINCT o.id FROM contacts c JOIN organization_contacts oc ON oc.contact_id=c.id AND oc.active=true JOIN organizations o ON o.id=oc.organization_id AND o.consolidated_into_id IS NULL WHERE lower(trim(c.email))=ANY($1::text[]) ORDER BY o.id LIMIT 20`,
        [emails],
      )
    ).rows.map((r) => r.id);
  }
  async resolve(
    connectionId: string,
    threadId: string,
  ): Promise<
    { kind: "matched"; profileId: string } | { kind: "review"; reason: string }
  > {
    const rows = (
      await this.db.query(
        `SELECT DISTINCT organization_id FROM google_workspace_validation_mappings WHERE connection_id=$1 AND thread_id=$2`,
        [connectionId, threadId],
      )
    ).rows;
    if (rows.length === 1 && rows[0].organization_id)
      return { kind: "matched", profileId: rows[0].organization_id };
    return {
      kind: "review",
      reason: rows.length
        ? "SYNC_PROFILE_CONFLICT"
        : "SYNC_PROFILE_LINK_REQUIRED",
    };
  }
}
