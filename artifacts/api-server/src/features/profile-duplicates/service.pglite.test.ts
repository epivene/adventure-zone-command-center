import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { ProfileDuplicatesService } from "./service";
import { findPairs, scorePair } from "./matching";

const a = "00000000-0000-4000-8000-000000000001",
  b = "00000000-0000-4000-8000-000000000002";
let db: PGlite, service: ProfileDuplicatesService;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(`SET TIME ZONE 'UTC';
    CREATE TABLE organizations(id uuid PRIMARY KEY,name text,city text,region text,phone text,consolidated_into_id uuid REFERENCES organizations,consolidated_at timestamptz,updated_at timestamptz DEFAULT now());
    CREATE TABLE organization_locations(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations,label text);
    CREATE TABLE contacts(id uuid PRIMARY KEY,organization_id uuid,first_name text);
    CREATE TABLE organization_contacts(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations,contact_id uuid REFERENCES contacts,role text,is_primary boolean,active boolean,UNIQUE(organization_id,contact_id));
    CREATE UNIQUE INDEX primary_contact ON organization_contacts(organization_id) WHERE active AND is_primary;
    ALTER TABLE contacts ADD FOREIGN KEY(organization_id,id) REFERENCES organization_contacts(organization_id,contact_id);
    CREATE TABLE bookings(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations,title text);
    CREATE TABLE notes(id uuid PRIMARY KEY,profile_id uuid REFERENCES organizations,body text);
    CREATE TABLE profile_deadlines(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations,due_on date);
    CREATE TABLE documents(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations,url text);
    CREATE TABLE relationship_health(id uuid PRIMARY KEY,organization_id uuid REFERENCES organizations,score integer);
    CREATE TABLE chatgpt_external_drafts(id uuid PRIMARY KEY,content jsonb,revision uuid);
    INSERT INTO organizations(id,name,city,region) VALUES('${a}','Wyoming State Fair','Douglas','WY'),('${b}','County Fair - Wyoming State Fair','Douglas','WY');
    INSERT INTO contacts(id,first_name) VALUES('10000000-0000-4000-8000-000000000001','Shauna');
    INSERT INTO organization_contacts VALUES('20000000-0000-4000-8000-000000000001','${b}','10000000-0000-4000-8000-000000000001','Organizer',true,true);
    UPDATE contacts SET organization_id='${b}';
    INSERT INTO bookings VALUES('30000000-0000-4000-8000-000000000001','${b}','Fall booking');
    INSERT INTO notes VALUES('40000000-0000-4000-8000-000000000001','${b}','Keep the original note');
    INSERT INTO profile_deadlines VALUES('50000000-0000-4000-8000-000000000001','${b}','2027-01-15');
    INSERT INTO documents VALUES('60000000-0000-4000-8000-000000000001','${b}','https://example.test/contract');
    INSERT INTO relationship_health VALUES('70000000-0000-4000-8000-000000000001','${b}',85);
    INSERT INTO chatgpt_external_drafts VALUES('80000000-0000-4000-8000-000000000001','{"organizationId":"${b}","body":"Draft untouched"}','90000000-0000-4000-8000-000000000001');`);
  await db.exec(
    await readFile(
      new URL(
        "../../../../../lib/db/migrations/20261015_reversible_profile_duplicates.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  service = new ProfileDuplicatesService(db as any);
});
afterEach(async () => {
  await db.close();
});
async function merge() {
  const p = await service.preview([a, b]);
  return service.merge({
    survivorId: a,
    sourceId: b,
    fingerprint: p.fingerprint,
    choices: { name: b, contacts: b },
    confirmed: true,
  });
}
describe("reversible profile duplicates", () => {
  it("scans without writes and honors permanent pair dismissal", async () => {
    expect((await service.scan()).pairs).toHaveLength(1);
    expect(await service.history()).toHaveLength(0);
    await service.dismiss([b, a]);
    await service.dismiss([a, b]);
    expect((await service.scan()).pairs).toHaveLength(0);
    expect((await db.query("SELECT * FROM organizations")).rows).toHaveLength(
      2,
    );
  });
  it("archives, reparents every discovered relation, retains IDs and exactly undoes", async () => {
    const before = await service.preview([a, b]);
    const result = await merge();
    expect(
      (
        await db.query(
          "SELECT consolidated_into_id FROM organizations WHERE id=$1",
          [b],
        )
      ).rows[0],
    ).toEqual({ consolidated_into_id: a });
    for (const [table, col] of [
      ["bookings", "organization_id"],
      ["notes", "profile_id"],
      ["profile_deadlines", "organization_id"],
      ["documents", "organization_id"],
      ["relationship_health", "organization_id"],
      ["contacts", "organization_id"],
    ])
      expect(
        (await db.query(`SELECT ${col} AS parent FROM ${table}`)).rows[0],
      ).toEqual({ parent: a });
    expect(
      (await db.query("SELECT content FROM chatgpt_external_drafts")).rows[0],
    ).toEqual({ content: { organizationId: a, body: "Draft untouched" } });
    await service.undo(result.id);
    expect((await service.preview([a, b])).fingerprint).toBe(
      before.fingerprint,
    );
    expect((await service.history())[0].undone_at).toBeTruthy();
    await service.undo(result.id);
  });
  it("rejects stale linked data without any writes", async () => {
    const p = await service.preview([a, b]);
    await db.query("UPDATE notes SET body='New owner edit'");
    await expect(
      service.merge({
        survivorId: a,
        sourceId: b,
        fingerprint: p.fingerprint,
        choices: {},
        confirmed: true,
      }),
    ).rejects.toThrow("changed");
    expect(await service.history()).toHaveLength(0);
  });
  it("rolls the entire merge back on uniqueness conflict", async () => {
    await db.exec(
      `CREATE TABLE unique_link(id uuid PRIMARY KEY,organization_id uuid UNIQUE REFERENCES organizations); INSERT INTO unique_link VALUES(gen_random_uuid(),'${a}'),(gen_random_uuid(),'${b}');`,
    );
    const before = await service.preview([a, b]);
    await expect(merge()).rejects.toThrow("Conflicting linked records");
    expect((await service.preview([a, b])).fingerprint).toBe(
      before.fingerprint,
    );
  });
  it("preserves both shared-contact roles and undoes them", async () => {
    await db.exec(
      `INSERT INTO organization_contacts VALUES(gen_random_uuid(),'${a}','10000000-0000-4000-8000-000000000001','Different role',true,true)`,
    );
    const before = await service.preview([a, b]);
    const result = await merge();
    expect(
      result.conflicts.some((c) => c.table === "organization_contacts"),
    ).toBe(true);
    expect(
      (await db.query("SELECT * FROM organization_contacts")).rows,
    ).toHaveLength(2);
    await service.undo(result.id);
    expect((await service.preview([a, b])).fingerprint).toBe(
      before.fingerprint,
    );
  });
  it("keeps an active source contact visible when the survivor membership was inactive", async () => {
    await db.exec(
      `INSERT INTO organization_contacts VALUES(gen_random_uuid(),'${a}','10000000-0000-4000-8000-000000000001','Former role',false,false)`,
    );
    const before = await service.preview([a, b]);
    const result = await merge();
    expect(
      (
        await db.query(
          "SELECT active,is_primary FROM organization_contacts WHERE organization_id=$1",
          [a],
        )
      ).rows[0],
    ).toEqual({ active: true, is_primary: true });
    await service.undo(result.id);
    expect((await service.preview([a, b])).fingerprint).toBe(
      before.fingerprint,
    );
  });
  it("does not overwrite later work during undo", async () => {
    const result = await merge();
    await db.exec("UPDATE organizations SET name='Later owner edit'");
    await expect(service.undo(result.id)).rejects.toThrow("changed");
    expect(
      (await db.query("SELECT name FROM organizations LIMIT 1")).rows[0],
    ).toEqual({ name: "Later owner edit" });
  });
  it("retains undo beyond 30 days", async () => {
    const result = await merge();
    await db.exec(
      "UPDATE profile_merge_journal SET created_at=now()-interval '45 days'",
    );
    await service.undo(result.id);
    expect((await service.preview([a, b])).profiles).toHaveLength(2);
  });
  it("undo retains subsequent note edits and newly created records", async () => {
    const result = await merge();
    await db.exec(
      `UPDATE notes SET body='Later note edit'; INSERT INTO bookings VALUES(gen_random_uuid(),'${a}','New booking after merge');`,
    );
    await service.undo(result.id);
    expect(
      (await db.query("SELECT profile_id,body FROM notes")).rows[0],
    ).toEqual({ profile_id: b, body: "Later note edit" });
    expect(
      (
        await db.query(
          "SELECT organization_id FROM bookings WHERE title='New booking after merge'",
        )
      ).rows[0],
    ).toEqual({ organization_id: a });
  });
  it("moves and restores location ownership before dependent contacts", async () => {
    await db.exec(`ALTER TABLE contacts ADD COLUMN organization_location_id uuid REFERENCES organization_locations;
      CREATE FUNCTION check_contact_location() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF NEW.organization_id IS NOT NULL AND NEW.organization_location_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM organization_locations WHERE id=NEW.organization_location_id AND organization_id=NEW.organization_id) THEN RAISE EXCEPTION 'location mismatch'; END IF;
        RETURN NEW; END $$;
      CREATE TRIGGER contact_location BEFORE UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION check_contact_location();
      INSERT INTO organization_locations VALUES('a0000000-0000-4000-8000-000000000001','${b}','Main venue');
      UPDATE contacts SET organization_location_id='a0000000-0000-4000-8000-000000000001';`);
    const before = await service.preview([a, b]);
    const result = await merge();
    await service.undo(result.id);
    expect((await service.preview([a, b])).fingerprint).toBe(
      before.fingerprint,
    );
  });
});
it("matches distinctive subtitles and separates generic fairs", () => {
  const match = scorePair(
    { id: a, name: "Wyoming's Big Show", region: "WY" },
    {
      id: b,
      name: "Sweetwater County Fair - Wyoming's Big Show",
      region: "WY",
    },
  );
  expect(match?.confidence).toBe("Medium");
  expect(
    findPairs([
      { id: a, name: "County Fair", city: "Douglas" },
      { id: b, name: "County Fair", city: "Casper" },
    ]),
  ).toEqual([]);
  expect(
    scorePair(
      { id: a, name: "Lincoln County Fair", city: "Afton", region: "WY" },
      { id: b, name: "Lincoln County Fair", city: "Eureka", region: "MT" },
    )?.confidence,
  ).toBe("Low");
  expect(
    scorePair(
      {
        id: a,
        name: "Bear Lake County Fair",
        city: "Montpelier",
        region: "ID",
      },
      {
        id: b,
        name: "Bear Lake Harvest Festival",
        city: "Montpelier",
        region: "ID",
      },
    )?.confidence,
  ).not.toBe("High");
  expect(
    scorePair(
      { id: a, name: "Armada Fair - Open", city: "Armada", region: "MI" },
      { id: b, name: "Armada Fair - Youth", city: "Armada", region: "MI" },
    )?.confidence,
  ).toBe("Low");
  expect(
    scorePair(
      { id: a, name: "Sweetwater County Fair", region: "WY" },
      {
        id: b,
        name: "Sweetwater County Fair - Wyoming's Big Show",
        region: "WY",
      },
    )?.confidence,
  ).toBe("Medium");
});

async function seedBackupIdentities(includeSurvivor = true) {
  await db.exec(`
  CREATE TABLE google_drive_backup_jobs(
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_kind text NOT NULL,entity_id uuid NOT NULL,
   status text NOT NULL DEFAULT 'queued',request_generation bigint NOT NULL DEFAULT 1,
   claimed_generation bigint,locked_by text,run_id uuid,UNIQUE(entity_kind,entity_id));
  CREATE TABLE google_drive_backup_mappings(
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entity_kind text NOT NULL,entity_id uuid NOT NULL,
   drive_file_id text NOT NULL UNIQUE,source_removed_at timestamptz,source_version text,
   UNIQUE(entity_kind,entity_id));
 `);
  for (const id of includeSurvivor ? [a, b] : [b]) {
    for (const kind of ["profile_summary", "follow_up_summary"]) {
      await db.query(
        "INSERT INTO google_drive_backup_jobs(entity_kind,entity_id,status,request_generation,claimed_generation,locked_by) VALUES($1,$2,'processing',7,6,'backup-worker')",
        [kind, id],
      );
      await db.query(
        "INSERT INTO google_drive_backup_mappings(entity_kind,entity_id,drive_file_id,source_version) VALUES($1,$2,$3,'saved-version')",
        [kind, id, kind + "-" + id],
      );
    }
  }
}
async function backupIdentities() {
  return {
    jobs: (
      await db.query(
        "SELECT * FROM google_drive_backup_jobs ORDER BY entity_kind,entity_id",
      )
    ).rows,
    mappings: (
      await db.query(
        "SELECT * FROM google_drive_backup_mappings ORDER BY entity_kind,entity_id",
      )
    ).rows,
  };
}
it("merges profiles with colliding backup identities while preserving all backup files and leases through undo", async () => {
  await seedBackupIdentities();
  const backups = await backupIdentities(),
    before = await service.preview([a, b]);
  const result = await merge();
  expect(await backupIdentities()).toEqual(backups);
  expect(
    (await db.query("SELECT organization_id FROM bookings")).rows[0]
      .organization_id,
  ).toBe(a);
  await service.undo(result.id);
  expect(await backupIdentities()).toEqual(backups);
  expect((await service.preview([a, b])).fingerprint).toBe(before.fingerprint);
});
it("retains source-only backup identities instead of renaming them to the survivor", async () => {
  await seedBackupIdentities(false);
  const backups = await backupIdentities();
  await merge();
  expect(await backupIdentities()).toEqual(backups);
});
it("allows independent backup worker progress between preview, merge and undo", async () => {
  await seedBackupIdentities();
  const preview = await service.preview([a, b]);
  await db.query(
    "UPDATE google_drive_backup_jobs SET request_generation=8,locked_by='new-worker'",
  );
  await db.query(
    "UPDATE google_drive_backup_mappings SET source_version='worker-version'",
  );
  const result = await service.merge({
    survivorId: a,
    sourceId: b,
    fingerprint: preview.fingerprint,
    choices: { name: b, contacts: b },
    confirmed: true,
  });
  await db.query(
    "UPDATE google_drive_backup_jobs SET status='succeeded',locked_by=null",
  );
  await db.query(
    "UPDATE google_drive_backup_mappings SET source_removed_at=now() WHERE entity_id=$1",
    [b],
  );
  const progressed = await backupIdentities();
  await service.undo(result.id);
  expect(await backupIdentities()).toEqual(progressed);
  expect(
    (
      await db.query(
        "SELECT consolidated_into_id FROM organizations WHERE id=$1",
        [b],
      )
    ).rows[0].consolidated_into_id,
  ).toBeNull();
});
