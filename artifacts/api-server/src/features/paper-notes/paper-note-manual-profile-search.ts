import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import type {
  PaperNoteMatch,
  PaperNoteMatchDetails,
} from "./paper-note-matching-service";
import { PostgresPaperNoteMatchRepository } from "./paper-note-matching-service";

export type PaperNoteManualProfileRow = {
  organizationId: string;
  name: string;
  city: string | null;
  region: string | null;
};

export interface PaperNoteManualProfileSearchRepository {
  searchProfiles(query: string, limit: number): Promise<PaperNoteManualProfileRow[]>;
  findDetails(organizationIds: string[]): Promise<Map<string, PaperNoteMatchDetails>>;
}

export class PaperNoteManualProfileSearchService {
  constructor(private readonly repository: PaperNoteManualProfileSearchRepository) {}

  async search(query: string, limit = 8): Promise<PaperNoteMatch[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const safeLimit = Math.max(1, Math.min(10, Math.trunc(limit) || 8));
    const rows = await this.repository.searchProfiles(trimmed, safeLimit);
    const details = await this.repository.findDetails(rows.map((row) => row.organizationId));
    return rows.map((row) => ({
      organizationId: row.organizationId,
      organizationLocationId: null,
      name: row.name,
      city: row.city,
      region: row.region,
      strength: "possible" as const,
      score: 0,
      reasons: ["manual profile search"],
      ...(details.get(row.organizationId) ?? { contacts: [], organizationPhones: [] }),
    }));
  }
}

type DrizzleDatabase = typeof database;

export class PostgresPaperNoteManualProfileSearchRepository implements PaperNoteManualProfileSearchRepository {
  private readonly details: PostgresPaperNoteMatchRepository;

  constructor(private readonly database: DrizzleDatabase) {
    this.details = new PostgresPaperNoteMatchRepository(database);
  }

  async searchProfiles(query: string, limit: number): Promise<PaperNoteManualProfileRow[]> {
    const pattern = `%${query.toLowerCase()}%`;
    const result = await this.database.execute(sql`
      select
        org.id as "organizationId",
        org.name,
        coalesce(
          (select loc.city from organization_locations loc where loc.organization_id = org.id and loc.city is not null order by loc.created_at asc limit 1),
          org.city
        ) as city,
        coalesce(
          (select loc.region from organization_locations loc where loc.organization_id = org.id and loc.region is not null order by loc.created_at asc limit 1),
          org.region
        ) as region
      from organizations org
      where org.consolidated_into_id is null
        and (
          lower(org.name) like ${pattern}
          or lower(coalesce(org.city, '')) like ${pattern}
          or lower(coalesce(org.region, '')) like ${pattern}
          or lower(coalesce(org.phone, '')) like ${pattern}
          or lower(coalesce(org.website, '')) like ${pattern}
          or exists (
            select 1
            from organization_locations loc
            where loc.organization_id = org.id
              and (
                lower(coalesce(loc.label, '')) like ${pattern}
                or lower(coalesce(loc.venue_name, '')) like ${pattern}
                or lower(coalesce(loc.city, '')) like ${pattern}
                or lower(coalesce(loc.region, '')) like ${pattern}
                or lower(coalesce(loc.phone, '')) like ${pattern}
                or lower(coalesce(loc.email, '')) like ${pattern}
              )
          )
          or exists (
            select 1
            from organization_contacts oc
            join contacts c on c.id = oc.contact_id
            where oc.organization_id = org.id
              and oc.active = true
              and (
                lower(trim(concat_ws(' ', c.first_name, c.last_name))) like ${pattern}
                or lower(coalesce(c.email, '')) like ${pattern}
                or lower(coalesce(c.phone, '')) like ${pattern}
              )
          )
        )
      order by
        case when lower(org.name) = lower(${query}) then 0 else 1 end,
        org.name asc,
        org.id asc
      limit ${limit}
    `);
    return ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []).map((row) => ({
      organizationId: String(row.organizationId),
      name: String(row.name ?? ""),
      city: row.city ? String(row.city) : null,
      region: row.region ? String(row.region) : null,
    }));
  }

  findDetails(organizationIds: string[]) {
    return this.details.findDetails(organizationIds);
  }
}
