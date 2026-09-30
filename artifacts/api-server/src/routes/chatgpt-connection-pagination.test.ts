import { it, expect } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { fixture } from "../features/chatgpt-connection/test-database";
import { createChatGPTConnectionRouter } from "./chatgpt-connection";
import { issueToken } from "../lib/auth";
it("paginates all owner drafts/proposals and retrieves old receipt targets without crossing owners", async () => {
  process.env.OWNER_PASSWORD = "test";
  process.env.SESSION_SECRET = "pagination-secret";
  const f = await fixture();
  try {
    const draft = randomUUID(),
      proposal = randomUUID();
    await f.db.query(
      "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision,created_at,updated_at) VALUES($1,'owner',$2,'{}',$3,'2020-01-01','2020-01-01')",
      [draft, f.principal.connectionId, randomUUID()],
    );
    await f.db.query(
      "INSERT INTO chatgpt_update_proposals(id,connection_id,profile_id,content,content_hash,revision,created_at) VALUES($1,$2,$3,'{}','hash','revision','2020-01-01')",
      [proposal, f.principal.connectionId, f.profileId],
    );
    await f.db.query(
      "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) SELECT gen_random_uuid(),'owner',$1,'{}',gen_random_uuid() FROM generate_series(1,51)",
      [f.principal.connectionId],
    );
    await f.db.query(
      "INSERT INTO chatgpt_update_proposals(id,connection_id,profile_id,content,content_hash,revision) SELECT gen_random_uuid(),$1,$2,'{}','hash','revision' FROM generate_series(1,51)",
      [f.principal.connectionId, f.profileId],
    );
    const hidden = randomUUID();
    await f.db.query(
      "INSERT INTO chatgpt_external_drafts(id,owner_id,connection_id,content,revision) VALUES($1,'other',$2,'{}',$3)",
      [hidden, f.principal.connectionId, randomUUID()],
    );
    const app = express();
    app.use(
      "/connection",
      createChatGPTConnectionRouter({
        enabled: true,
        appOrigin: "https://app.example",
        resource: "https://app.example/api/chatgpt/mcp",
        db: f.db,
      }),
    );
    const token = issueToken()!.token;
    for (const [type, id] of [
      ["drafts", draft],
      ["proposals", proposal],
    ]) {
      const detail = await request(app)
        .get(`/connection/${type}/${id}`)
        .auth(token, { type: "bearer" });
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(id);
      const ids = new Set();
      let cursor = "";
      do {
        const page = await request(app)
          .get(`/connection/${type}`)
          .query(cursor ? { cursor } : {})
          .auth(token, { type: "bearer" });
        expect(page.status).toBe(200);
        page.body.items.forEach((r: any) => ids.add(r.id));
        cursor = page.body.nextCursor ?? "";
      } while (cursor);
      expect(ids.size).toBe(52);
      expect(ids.has(id)).toBe(true);
    }
    expect(
      (
        await request(app)
          .get("/connection/drafts/" + hidden)
          .auth(token, { type: "bearer" })
      ).status,
    ).toBe(404);
  } finally {
    await f.db.close();
  }
});
