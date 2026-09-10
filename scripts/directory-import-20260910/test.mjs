import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const template=await fs.readFile(new URL('./import-template.sql',import.meta.url),'utf8');
const all=JSON.parse(await fs.readFile(new URL('./seed.json',import.meta.url),'utf8'));
// Minimal fixture follows the production columns, FKs, unique primary-contact and activity constraints.
const schema=`
CREATE TABLE organizations(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,place_type text NOT NULL DEFAULT 'other',address_1 text,city text,region text,postal_code text,website text,phone text,normalized_phone text,consolidated_into_id uuid,updated_at timestamptz DEFAULT now());
CREATE TABLE contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES organizations(id),first_name text NOT NULL,last_name text NOT NULL,email text,phone text,normalized_phone text);
CREATE TABLE organization_contacts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES organizations(id),contact_id uuid REFERENCES contacts(id),role text,is_primary boolean DEFAULT false,active boolean DEFAULT true,source text,UNIQUE(organization_id,contact_id));
CREATE UNIQUE INDEX only_primary ON organization_contacts(organization_id) WHERE is_primary AND active;
ALTER TABLE contacts ADD CONSTRAINT contacts_primary_organization_contact_fk FOREIGN KEY(organization_id,id) REFERENCES organization_contacts(organization_id,contact_id);
CREATE TABLE activities(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid REFERENCES organizations(id),contact_id uuid REFERENCES contacts(id),kind text,subject text,body text NOT NULL,occurred_at timestamptz NOT NULL,timeline_sort_at timestamptz NOT NULL,source_type text CHECK(source_type IN ('note','history','activity')));
`;
const prodConventions=await fs.readFile(new URL('../../lib/db/migrations/20260909c_convention_outreach.sql',import.meta.url),'utf8');
async function base(){const db=new PGlite();await db.exec(schema+prodConventions);await db.exec("INSERT INTO convention_editions(convention,year) SELECT unnest(ARRAY['Arizona AFA','Colorado','Heartland','RMAF','Wyoming']),2026");return db;}
const q=async(db,sql,args=[]) =>(await db.query(sql,args)).rows;
const one=async(db,sql,args=[]) =>(await q(db,sql,args))[0];
const run=(db,rows)=>db.exec(template.replace('__SEED__',JSON.stringify(rows)));
function row(overrides={}){return {name:'Example County Fair',placeType:'fair',region:'WY',city:'Example',group:'Wyoming fairs',edition:'Wyoming',category:'Fair',source:'https://example.org/directory',sourceKey:'example',contact:'Jamie Doe',email:'jamie@example.org',phone:'307-555-1234',website:'https://example.org',facts:{'2026 Dates':'August 1–4'},pages:[],notes:[],...overrides};}
const db=await base();
const org=await one(db,"INSERT INTO organizations(name,region,phone,website) VALUES ('Example County Fair','WY','307-555-1234','https://example.org') RETURNING id");
const contact=await one(db,"INSERT INTO contacts(first_name,last_name,email) VALUES ('Jamie','Doe','current@example.org') RETURNING id");
await db.query("INSERT INTO organization_contacts(organization_id,contact_id,is_primary,active) VALUES ($1,$2,true,true)",[org.id,contact.id]);
await db.query("UPDATE contacts SET organization_id=$1 WHERE id=$2",[org.id,contact.id]);
const edition=await one(db,"SELECT id FROM convention_editions WHERE convention='Wyoming'");
const special={sourceKey:'existing',event:'Example County Fair',contact:'Jamie Doe',email:'current@example.org',group:'special',outcome:'do_not_contact',attendance:'prior_contact',notes:'Dave only. Service recovery.',conventionResponse:{met:true,interested:false,followUp:false,contact:'Jamie',notes:'Keep history'},research:{existing:'preserve'}};
await db.query("INSERT INTO convention_members(edition_id,source_key,organization_id,contact_id,data) VALUES ($1,'existing',$2,$3,$4)",[edition.id,org.id,contact.id,JSON.stringify(special)]);
await db.exec("INSERT INTO organizations(name,region) VALUES ('Duplicate County Fair','WY'),('Duplicate County Fair','WY'),('Unknown County Fair',NULL)");
const unlinked={sourceKey:'unlinked',event:'Another County Fair',contact:'Robin Doe',email:'',group:'confirm',outcome:'not_contacted',notes:'Needs research',attendance:'unknown'};
await db.query("INSERT INTO convention_members(edition_id,source_key,data) VALUES ($1,'unlinked',$2)",[edition.id,JSON.stringify(unlinked)]);
const fixtures=[row(),row({name:'Example County Fair',region:'CO',sourceKey:'co',edition:null,group:'ShoWorks',contact:'',email:'',website:'',phone:''}),row({name:'Duplicate County Fair',sourceKey:'dup',website:'',phone:''}),row({name:'Unknown County Fair',sourceKey:'unknown',website:'',phone:''}),row({name:'Another County Fair',sourceKey:'another',contact:'Robin Doe',email:'',website:'',phone:''}),row({name:'Unlinked Alias',sourceKey:'bad-known',knownOrganizationId:'00000000-0000-0000-0000-000000000001'}),row({name:'The Adventure Zone',sourceKey:'self'})];
await run(db,fixtures);
assert.equal((await one(db,'SELECT count(*)::int n FROM organizations')).n,6,'different-state fair created, duplicates held');
assert.equal((await one(db,'SELECT email FROM contacts WHERE id=$1',[contact.id])).email,'current@example.org');
const after=(await one(db,"SELECT data FROM convention_members WHERE source_key='existing'")).data;
for(const [k,v] of Object.entries(special))if(k!=='research')assert.deepEqual(after[k],v,`preserve ${k}`);
assert.equal(after.research.existing,'preserve');
assert.equal((await one(db,"SELECT count(*)::int n FROM convention_members WHERE data->>'event'='Another County Fair'")).n,1);
assert.ok((await one(db,"SELECT organization_id FROM convention_members WHERE source_key='unlinked'")).organization_id);
assert.equal((await one(db,"SELECT count(*)::int n FROM directory_import_records WHERE status='review'")).n,3);
assert.equal((await one(db,"SELECT count(*)::int n FROM directory_import_records WHERE status='excluded'")).n,1);
const counts=async()=>one(db,"SELECT (SELECT count(*) FROM organizations)::int orgs,(SELECT count(*) FROM contacts)::int contacts,(SELECT count(*) FROM activities)::int notes,(SELECT count(*) FROM convention_members)::int cards,(SELECT count(*) FROM convention_history)::int history,(SELECT sum(revision) FROM convention_editions)::int revisions");
const first=await counts();await run(db,fixtures);assert.deepEqual(await counts(),first,'repeat import is a no-op');
await db.close();
// Full 1,235-row seed: exact observed AFA profile IDs are represented in the isolated database.
const full=await base();
const known=new Map(all.filter(r=>r.knownOrganizationId).map(r=>[r.knownOrganizationId,r]));
for(const [id,r] of known)await full.query('INSERT INTO organizations(id,name,region,city) VALUES($1,$2,$3,$4)',[id,r.name,r.region||null,r.city||null]);
await run(full,all);
assert.equal((await one(full,'SELECT count(*)::int n FROM directory_import_records')).n,all.length);
assert.equal((await one(full,"SELECT count(*)::int n FROM convention_members WHERE data->>'attendance'<>'association_only'")).n,0);
assert.equal((await one(full,"SELECT count(*)::int n FROM convention_members m JOIN directory_import_records r ON m.source_key='directory:'||r.source_key WHERE r.payload->>'group'='ShoWorks'")).n,0,'general leads not falsely attached to conventions');
const stats=await q(full,'SELECT status,count(*)::int count FROM directory_import_records GROUP BY status ORDER BY status');
const review=await q(full,"SELECT payload->>'name' name,payload->>'group' directory,reason FROM directory_import_records WHERE status='review'");
console.log(JSON.stringify({tests:'PASS',rows:all.length,isolatedFixtureCounts:stats,review},null,2));
await full.close();
