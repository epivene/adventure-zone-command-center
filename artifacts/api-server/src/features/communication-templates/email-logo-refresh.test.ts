import { afterEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { refreshEmailLogos, replaceEmailLogo } from "./email-logo-refresh";

const old = "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-logo-navy.png";
const next = "https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-logo-tagline-20260910.png";
let pg: PGlite;
afterEach(async () => { await pg?.close(); });

describe("saved email logo refresh", () => {
  it.each([old, next, "video-only"])("updates active templates and pending snapshots only, preserving wording, layout, approvals and repeatability", async (source) => {
    pg = new PGlite();
    await pg.exec(`
      create table communication_templates(id text primary key, code text default 'convention_after_new_v2', body_template text not null, body_format text not null, state text not null, reviewed_by text, reviewed_at timestamptz, updated_at timestamptz default now());
      create table boss_work_requests(id text primary key, state text not null, deduplication_key text, updated_at timestamptz default now());
      create table communication_template_reviews(id text primary key, request_id text not null references boss_work_requests(id), template_id text not null references communication_templates(id), position integer not null, template_version text, subject_snapshot text, body_snapshot text not null, body_format_snapshot text not null, content_fingerprint text not null, decision text not null, verified_links jsonb not null default '[]', updated_at timestamptz default now());
      create unique index reviews_position on communication_template_reviews(request_id,position);
      create unique index reviews_template on communication_template_reviews(request_id,template_id);
      create table boss_work_request_events(request_id text, actor_kind text, actor_id text, prior_state text, new_state text, note text);
    `);
    const body = source === "video-only" ? `<p>My edited wording</p><a href="https://youtu.be/-xTjCJz9RmI?feature=shared">Watch Warrior’s Playground</a>` : `<table><tr><td style="background:#0f1729"><img src="${source}" width="390" style="height:auto;max-width:92%"></td></tr><tr><td style="background:#0f1729"><span class="eyebrow">CONFERENCE SEASON</span><p>My edited wording</p></td></tr></table>`;
    for (const [id, state] of [["one", "active"], ["two", "draft"], ["three", "archived"]]) {
      await pg.query("insert into communication_templates(id,body_template,body_format,state,reviewed_by) values ($1,$2,'html',$3,'Dave')", [id, body, state]);
    }
    await pg.exec("insert into boss_work_requests(id,state,deduplication_key) values ('open','in_progress','convention-template-review-set:old'),('done','approved','old-done')");
    for (const [id, request, template, position, decision] of [["pending", "open", "one", 0, "pending"], ["decided", "open", "two", 1, "approved"], ["historic", "done", "one", 0, "approved"]]) {
      await pg.query("insert into communication_template_reviews(id,request_id,template_id,position,template_version,subject_snapshot,body_snapshot,body_format_snapshot,content_fingerprint,decision) values($1,$2,$3,$4,'v10','Hello',$5,'html','old-fingerprint',$6)", [id, request, template, position, body, decision]);
    }
    const db = drizzle(pg) as unknown as Parameters<typeof refreshEmailLogos>[0];
    await refreshEmailLogos(db);
    const templates = (await pg.query<{id:string;body_template:string;state:string;reviewed_by:string|null}>("select * from communication_templates order by id")).rows;
    expect(templates.find(t => t.id === "one")).toMatchObject({body_template: replaceEmailLogo(body, "convention_after_new_v2"),state:"reviewed",reviewed_by:null});
    expect(templates.find(t => t.id === "two")).toMatchObject({body_template:replaceEmailLogo(body, "convention_after_new_v2"),state:"draft"});
    expect(templates.find(t => t.id === "three")).toMatchObject({body_template:replaceEmailLogo(body, "convention_after_new_v2"),state:"archived"});
    const reviews = (await pg.query<{id:string;body_snapshot:string;content_fingerprint:string;decision:string}>("select * from communication_template_reviews order by id")).rows;
    expect(reviews.find(r => r.id === "pending")).toMatchObject({body_snapshot:replaceEmailLogo(body, "convention_after_new_v2"),decision:"pending"});
    expect(reviews.find(r => r.id === "pending")?.content_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(reviews.find(r => r.id === "decided")).toMatchObject({body_snapshot:body,content_fingerprint:"old-fingerprint",decision:"approved"});
    expect(reviews.find(r => r.id === "historic")).toMatchObject({body_snapshot:body,content_fingerprint:"old-fingerprint"});
    const beforeRepeat = await pg.query("select * from communication_template_reviews order by id");
    await refreshEmailLogos(db);
    expect((await pg.query("select * from communication_template_reviews order by id")).rows).toEqual(beforeRepeat.rows);
    expect((await pg.query("select * from boss_work_request_events")).rows).toHaveLength(1);
    expect((await pg.query<{deduplication_key:string}>("select deduplication_key from boss_work_requests where id='open'")).rows[0].deduplication_key).not.toBe("convention-template-review-set:old");
  });
});


