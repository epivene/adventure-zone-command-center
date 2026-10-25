import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  readComDraftContext,
  renderComTemplate,
  previewComDraft,
} from "./com-draft-context";
const org = "10000000-0000-4000-8000-000000000001",
  template = "20000000-0000-4000-8000-000000000001";
const clients: PGlite[] = [];
async function setup() {
  const db = new PGlite();
  clients.push(db);
  await db.exec(`
CREATE TABLE organizations(id uuid,name text,consolidated_into_id uuid);
CREATE TABLE activities(id uuid DEFAULT gen_random_uuid(),organization_id uuid,kind text,body text,occurred_at timestamptz,deleted_at timestamptz);
CREATE TABLE bookings(id uuid DEFAULT gen_random_uuid(),organization_id uuid,name text,status text,starts_at timestamptz,ends_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE google_workspace_profile_email_threads(id uuid,organization_id uuid);
CREATE TABLE google_workspace_profile_email_messages(id uuid DEFAULT gen_random_uuid(),conversation_id uuid,subject text,body_text text,direction text,internal_date_ms bigint);
CREATE TABLE communication_templates(id uuid,code text,name text,category text,state text,body_format text,body_template text,subject_template text,reviewed_at timestamptz,template_version text,owner_kind text,channel text DEFAULT 'email',updated_at timestamptz DEFAULT now());
INSERT INTO organizations VALUES('${org}','County Fair',NULL);
INSERT INTO communication_templates(id,code,name,category,state,body_format,body_template,subject_template,reviewed_at,template_version,owner_kind) VALUES('${template}','approved-followup','Approved follow-up','follow_up','active','html','<p>Hello {{eventName}}: {{message}}</p>','The Adventure Zone for {{eventName}}',now(),'1','company');
INSERT INTO activities(organization_id,kind,body,occurred_at) SELECT '${org}','note','Recent note '||n,now()+n*interval '1 second' FROM generate_series(1,8) n;
INSERT INTO google_workspace_profile_email_threads VALUES('${org}','${org}');
INSERT INTO google_workspace_profile_email_messages(conversation_id,subject,body_text,direction,internal_date_ms) VALUES('${org}','Their question','Can you send a quote?','inbound',1);
INSERT INTO bookings(organization_id,name,status,starts_at) VALUES('${org}','2027 Fair','quote_sent','2027-06-01');
`);
  return db;
}
afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});
describe("COM draft context", () => {
  it("renders an editable template draft without invoking a model", async () => {
    const result = await previewComDraft(await setup(), {
      profileId: org,
      purpose: "follow_up",
      templateId: template,
      mergeFields: { message: "Checking on your quote" },
    });
    expect(result.subject).toBe("The Adventure Zone for County Fair");
    expect(result.bodyHtml).toBe(
      "<p>Hello County Fair: Checking on your quote</p>",
    );
  });
  it.each([
    ["new_outreach", "outreach"],
    ["reply", "contact"],
  ] as const)(
    "finds reviewed %s HTML in its production category",
    async (purpose, category) => {
      const db = await setup();
      await db.query("UPDATE communication_templates SET category=$1", [
        category,
      ]);
      expect(
        (await readComDraftContext(db, { profileId: org, purpose }))
          .approvedTemplate?.id,
      ).toBe(template);
    },
  );
  it("returns bounded notes, subject/snippet emails, booking status and approved HTML", async () => {
    const result = await readComDraftContext(await setup(), {
      profileId: org,
      purpose: "follow_up",
      templateId: template,
    });
    expect(result.notes).toHaveLength(5);
    expect(result.emails[0]).toMatchObject({
      subject: "Their question",
      snippet: "Can you send a quote?",
    });
    expect(result.bookings[0].status).toBe("quote_sent");
    expect(result.approvedTemplate?.html).toContain("{{message}}");
  });
  it("does not use unreviewed templates", async () => {
    const db = await setup();
    await db.exec("UPDATE communication_templates SET reviewed_at=NULL");
    await expect(
      readComDraftContext(db, {
        profileId: org,
        purpose: "follow_up",
        templateId: template,
      }),
    ).rejects.toMatchObject({ code: "APPROVED_TEMPLATE_REQUIRED" });
  });
  it("escapes merge values and refuses unresolved fields", () => {
    expect(
      renderComTemplate("<p>{{message}}</p>", {
        message: "<script>bad</script>",
      }),
    ).toBe("<p>&lt;script&gt;bad&lt;/script&gt;</p>");
    expect(() => renderComTemplate("<p>{{price}}</p>", {})).toThrow(/price/);
  });
});
