import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ConnectionError, requireConnectionScope, type ConnectionDatabase, type ConnectionPrincipal, type MutationKey } from "./contracts";
import { OperationStore } from "./operation-store";

export const createProfileContactInput = z.object({
  profileId: z.string().uuid(),
  expectedProfileRevision: z.string().min(1).max(100),
  firstName: z.string().trim().min(1).max(200),
  lastName: z.string().trim().max(200),
  email: z.string().trim().email().max(320).nullable(),
  jobTitle: z.string().trim().min(1).max(300).nullable(),
  sourceUrl: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }),
  evidence: z.string().trim().min(1).max(4000),
}).strict();

/** Add a sourced person to an existing profile; never replace an existing contact. */
export class ContactCreateService {
  constructor(private db: ConnectionDatabase) {}
  async create(p: ConnectionPrincipal, key: MutationKey, raw: z.infer<typeof createProfileContactInput>) {
    requireConnectionScope(p, "crm:append");
    const input = createProfileContactInput.parse(raw);
    input.email = input.email?.toLowerCase() ?? null;
    return new OperationStore(this.db).perform(p, "create_profile_contact", key, input, async tx => {
      // Serialize connector contact creation across clients and profiles, including shared inboxes.
      await tx.query("SELECT pg_advisory_xact_lock(hashtext('chatgpt-connection:contact-creation'))");
      const profile = (await tx.query("SELECT id,name,consolidated_into_id,updated_at::text AS revision FROM organizations WHERE id=$1 FOR UPDATE", [input.profileId])).rows[0];
      if (!profile || profile.consolidated_into_id) throw new ConnectionError("CONNECTION_PROFILE_UNAVAILABLE", 404);
      if (profile.revision !== input.expectedProfileRevision) throw new ConnectionError("CONNECTION_STALE_REVISION", 409);
      const candidates = (await tx.query(`SELECT c.id,c.first_name,c.last_name,c.organization_id,c.email FROM contacts c
        WHERE ($1::text IS NOT NULL AND lower(btrim(c.email))=$1)
        OR (lower(btrim(c.first_name))=lower($2) AND lower(btrim(coalesce(c.last_name,'')))=lower($3)
          AND (c.organization_id=$4 OR EXISTS(SELECT 1 FROM organization_contacts oc WHERE oc.contact_id=c.id AND oc.organization_id=$4)))
        ORDER BY c.id LIMIT 11`, [input.email,input.firstName,input.lastName,input.profileId])).rows;
      // Even inactive/imported contacts are candidates; do not resurrect or duplicate them silently.
      if (candidates.length) throw new ConnectionError("CONNECTION_CONTACT_DUPLICATE_CANDIDATE", 409,
        "Review existing contacts before adding a person: " + JSON.stringify(candidates));
      const contactId = randomUUID();
      // The primary-organization FK requires the relationship to exist before setting organization_id.
      await tx.query("INSERT INTO contacts(id,first_name,last_name,email,job_title) VALUES($1,$2,$3,$4,$5)",
        [contactId,input.firstName,input.lastName,input.email,input.jobTitle]);
      await tx.query("INSERT INTO organization_contacts(organization_id,contact_id,active,is_primary,source) VALUES($1,$2,true,false,'local')", [input.profileId,contactId]);
      await tx.query("UPDATE contacts SET organization_id=$2 WHERE id=$1", [contactId,input.profileId]);
      await tx.query("INSERT INTO act_contact_sync_states(contact_id,local_dirty,state) VALUES($1,true,'waiting')", [contactId]);
      const noteId = randomUUID();
      await tx.query("INSERT INTO activities(id,organization_id,contact_id,kind,subject,body,occurred_at,timeline_sort_at) VALUES($1,$2,$3,'note','Contact added',$4,now(),now())",
        [noteId,input.profileId,contactId,input.evidence + "\nSource: " + input.sourceUrl]);
      await tx.query(`INSERT INTO audit_entries(entity_type,entity_id,action,"before","after") VALUES('contact',$1,'create',NULL,$2::jsonb)`,
        [contactId,JSON.stringify({...input,contactId,noteId,actor:{ownerId:p.ownerId,connectionId:p.connectionId}})]);
      const saved = (await tx.query("SELECT updated_at::text AS revision FROM contacts WHERE id=$1", [contactId])).rows[0];
      const now = (await tx.query("SELECT now()::text AS saved_at")).rows[0];
      return {operationId:randomUUID(),recordId:contactId,href:`/profiles/${input.profileId}`,revision:saved.revision,savedAt:new Date(now.saved_at).toISOString(),
        value:{contactId,profileId:input.profileId,firstName:input.firstName,lastName:input.lastName,email:input.email,jobTitle:input.jobTitle,noteId,created:true}};
    });
  }
}
