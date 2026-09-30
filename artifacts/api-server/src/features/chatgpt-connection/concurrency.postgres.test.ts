import { ProfileUpdateService } from "./profile-update-service";
import { profileRow } from "./read-service";
import { it, expect } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { fixtureSql } from "./test-database";
import { ensureChatGPTConnectionSchema } from "../../db/chatgpt-connection-schema";
import { LeadNoteService } from "./lead-note-service";
import { OAuthStore } from "./oauth-store";
import { connectionScopes } from "./contracts";
it.skipIf(!process.env.TEST_DATABASE_URL)(
  "serializes cross-connection same-lead writes and refresh/revoke on PostgreSQL",
  async () => {
    const schema = "connection_test_" + randomUUID().replaceAll("-", "");
    const admin = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const db = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      options: `-c search_path=${schema}`,
      max: 4,
    });
    try {
      await ensureChatGPTConnectionSchema(db);
      await db.query(fixtureSql);
      const principals = [1, 2].map(() => ({
        ownerId: "owner",
        connectionId: randomUUID(),
        clientId: "client",
        scopes: connectionScopes,
      }));
      for (const p of principals)
        await db.query(
          "INSERT INTO chatgpt_connections(id,owner_id,client_id,scopes,grant_id) VALUES($1,$2,$3,$4,$5)",
          [
            p.connectionId,
            p.ownerId,
            p.clientId,
            JSON.stringify(p.scopes),
            p.connectionId,
          ],
        );
      const service = new LeadNoteService(db),
        lead = {
          name: "Test Fair",
          city: "Town",
          region: "UT",
          officialWebsite: "https://test.example/fair",
          sourceIdentity: null,
          eventYear: 2027,
          sources: [
            {
              url: "https://test.example/fair",
              retrievedAt: "2026-09-30T00:00:00Z",
              eventYear: 2027,
              claim: "Listing",
              verification: "unverified" as const,
            },
          ],
        };
      const saved = await Promise.all(
        principals.map((p, i) =>
          service.createLead(p, { requestKey: "create-" + i }, lead),
        ),
      );
      expect(saved[0].recordId).toBe(saved[1].recordId);
      expect((await db.query("SELECT * FROM organizations")).rows).toHaveLength(
        1,
      );
      const replay = await Promise.all(
        [1, 2].map(() =>
          service.appendNote(
            principals[0],
            { requestKey: "same" },
            {
              profileId: saved[0].recordId,
              subject: "Note",
              body: "Research",
              sources: lead.sources,
            },
          ),
        ),
      );
      expect(replay[0]).toEqual(replay[1]);
      const updates = new ProfileUpdateService(db);
      const proposal = await updates.propose(
        principals[0],
        { requestKey: "proposal" },
        {
          profileId: saved[0].recordId,
          expectedRevision: (await profileRow(db, saved[0].recordId)).revision,
          values: { city: "New Town" },
          sources: lead.sources,
        },
      );
      const approval = await updates.approve(
        "owner",
        proposal.recordId,
        proposal.value.contentHash,
      );
      const applied = await Promise.all(
        [1, 2].map(() =>
          updates.apply(
            principals[0],
            { requestKey: "apply" },
            { proposalId: proposal.recordId, approvalId: approval.approvalId },
          ),
        ),
      );
      expect(applied[0]).toEqual(applied[1]);
      const oauth = new OAuthStore(db, Buffer.alloc(32, 1));
      await Promise.allSettled([
        oauth
          .adapter("RefreshToken")
          .upsert("late", { grantId: principals[0].connectionId }, 60),
        oauth.revoke("owner", principals[0].connectionId),
      ]);
      expect(await oauth.adapter("RefreshToken").find("late")).toBeUndefined();
      expect(
        (await db.query("SELECT * FROM chatgpt_oauth_artifacts")).rows,
      ).toHaveLength(0);
    } finally {
      await db.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    }
  },
);
