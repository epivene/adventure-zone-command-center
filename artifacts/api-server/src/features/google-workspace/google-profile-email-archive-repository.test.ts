import { describe, expect, it, vi } from "vitest";

import { PostgresGoogleProfileEmailArchiveRepository } from "./google-profile-email-archive-repository";

function poolWith(handler: (sql: string, values: unknown[]) => Array<Record<string, unknown>>) {
  const query = vi.fn(async (sql: string, values: unknown[] = []) => ({
    rows: handler(sql.replace(/\s+/g, " ").trim(), values),
  }));
  return { pool: { query }, query };
}

const message = {
  gmailMessageId: "message-1",
  gmailThreadId: "thread-1",
  internalDateMs: 1788970000000,
  from: "fair@example.com",
  to: "zone@example.com",
  cc: "",
  subject: "County Fair",
  date: "Wed, 9 Sep 2026 10:00:00 -0600",
  direction: "incoming" as const,
  bodyText: "We would like to book.",
  attachments: [],
};

describe("PostgresGoogleProfileEmailArchiveRepository", () => {
  it("upserts a complete message archive idempotently under the active connection", async () => {
    const { pool, query } = poolWith((sql) => {
      if (sql.includes("SELECT id FROM google_workspace_connections")) {
        return [{ id: "connection-1" }];
      }
      if (sql.includes("RETURNING id") && sql.includes("profile_email_threads")) {
        return [{ id: "conversation-1" }];
      }
      if (sql.includes("FROM google_workspace_profile_email_threads thread")) {
        return [{
          id: "conversation-1",
          organization_id: "org-1",
          contact_id: null,
          subject: "County Fair",
          original_gmail_url: "https://mail.google.com/mail/u/0/#all/thread-1",
          archive_state: "complete",
          last_synced_at: new Date("2026-09-09T16:00:00.000Z"),
          last_gmail_error_code: null,
          provider_thread_ids: ["thread-1"],
        }];
      }
      if (sql.includes("FROM google_workspace_profile_email_messages")) {
        return [{
          id: "archive-message-1",
          gmail_message_id: "message-1",
          gmail_thread_id: "thread-1",
          internal_date_ms: "1788970000000",
          from_value: "fair@example.com",
          to_value: "zone@example.com",
          cc_value: "",
          subject: "County Fair",
          date_value: "Wed, 9 Sep 2026 10:00:00 -0600",
          direction: "incoming",
          body_text: "We would like to book.",
        }];
      }
      return [];
    });
    const repository = new PostgresGoogleProfileEmailArchiveRepository(pool);

    const input = {
      organizationId: "org-1",
      contactId: null,
      gmailThreadId: "thread-1",
      subject: "County Fair",
      originalGmailUrl: "https://mail.google.com/mail/u/0/#all/thread-1",
      archiveState: "complete" as const,
      lastSyncedAt: new Date("2026-09-09T16:00:00.000Z"),
      messages: [message],
    };
    await repository.upsertThread(input);
    await repository.upsertThread(input);

    const messageUpserts = query.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO google_workspace_profile_email_messages"),
    );
    expect(messageUpserts).toHaveLength(2);
    expect(String(messageUpserts[0]?.[0])).toContain(
      "ON CONFLICT (connection_id, gmail_message_id) DO UPDATE",
    );
    expect(query.mock.calls.some(([sql]) =>
      String(sql).startsWith("DELETE FROM google_workspace_profile_email"),
    )).toBe(false);
  });

  it("keeps a stable app conversation when a replacement Gmail thread is attached", async () => {
    const { pool, query } = poolWith((sql) => {
      if (sql.includes("SELECT id FROM google_workspace_connections")) {
        return [{ id: "connection-1" }];
      }
      if (sql.includes("RETURNING id") && sql.includes("profile_email_threads")) {
        return [{ id: "conversation-1" }];
      }
      if (sql.includes("FROM google_workspace_profile_email_threads thread")) {
        return [{
          id: "conversation-1",
          organization_id: "org-1",
          contact_id: null,
          subject: "County Fair",
          original_gmail_url: null,
          archive_state: "complete",
          last_synced_at: new Date("2026-09-09T16:00:00.000Z"),
          last_gmail_error_code: null,
          provider_thread_ids: ["thread-deleted", "thread-replacement"],
        }];
      }
      if (sql.includes("FROM google_workspace_profile_email_messages")) return [];
      return [];
    });
    const repository = new PostgresGoogleProfileEmailArchiveRepository(pool);

    await repository.upsertThread({
      conversationId: "conversation-1",
      organizationId: "org-1",
      contactId: null,
      gmailThreadId: "thread-replacement",
      subject: "Re: County Fair",
      originalGmailUrl: null,
      archiveState: "complete",
      lastSyncedAt: new Date("2026-09-09T16:00:00.000Z"),
      messages: [],
    });

    const sourceUpsert = query.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO google_workspace_profile_email_thread_sources"),
    );
    expect(sourceUpsert?.[1]).toEqual([
      "conversation-1",
      "connection-1",
      "thread-replacement",
    ]);
  });

  it("scopes detail reads to the requested organization", async () => {
    const { pool, query } = poolWith((sql) =>
      sql.includes("SELECT id FROM google_workspace_connections")
        ? [{ id: "connection-1" }]
        : [],
    );
    const repository = new PostgresGoogleProfileEmailArchiveRepository(pool);

    await expect(repository.getForOrganization({
      organizationId: "other-org",
      conversationId: "conversation-1",
    })).resolves.toBeNull();

    const read = query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM google_workspace_profile_email_threads thread"),
    );
    expect(String(read?.[0])).toContain("thread.organization_id = $2");
    expect(read?.[1]).toEqual(["connection-1", "other-org", "conversation-1"]);
  });

  it("records Gmail failures without deleting the saved conversation", async () => {
    const { pool, query } = poolWith((sql) =>
      sql.includes("SELECT id FROM google_workspace_connections")
        ? [{ id: "connection-1" }]
        : [],
    );
    const repository = new PostgresGoogleProfileEmailArchiveRepository(pool);

    await repository.recordSyncFailure({
      conversationId: "conversation-1",
      code: "GOOGLE_WORKSPACE_PROFILE_EMAIL_GMAIL_MISSING",
      now: new Date("2026-09-09T16:05:00.000Z"),
    });

    const update = query.mock.calls.find(([sql]) =>
      String(sql).includes("last_gmail_error_code"),
    );
    expect(String(update?.[0])).toContain("UPDATE google_workspace_profile_email_threads");
    expect(query.mock.calls.some(([sql]) => String(sql).includes("DELETE"))).toBe(false);
  });
});
