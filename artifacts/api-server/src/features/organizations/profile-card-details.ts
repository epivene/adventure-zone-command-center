import { sql } from "drizzle-orm";

export type ProfileCardDetails = {
  id: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  description: string | null;
  placeType: string | null;
  profileImageDataUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
};

type ExecuteQuery = (query: unknown) => Promise<{ rows?: any[] }>;
export type ProfileCardDetailErrorReporter = (
  scope: "photo" | "core" | "rating",
  error: unknown,
) => void;

export async function loadProfileCardDetailsWith(
  ids: string[],
  execute: ExecuteQuery,
  reportError?: ProfileCardDetailErrorReporter,
): Promise<Map<string, ProfileCardDetails>> {
  if (!ids.length) return new Map();

  // Keep every UUID as its own bound parameter. Passing the whole JS array as a
  // single ANY($1::uuid[]) value proved fragile with the production driver.
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql.raw(", "));

  let photoRows: any[] = [];
  try {
    const photoResult = await execute(sql`
      select
        o.id,
        o.profile_image_data_url as "profileImageDataUrl"
      from organizations o
      where o.id in (${idList})
    `);
    photoRows = photoResult.rows ?? [];
  } catch (error) {
    reportError?.("photo", error);
    photoRows = [];
  }

  let coreRows: any[] = [];
  try {
    const coreResult = await execute(sql`
      select
        o.id,
        coalesce(c.phone, o.phone) as phone,
        c.email,
        o.website,
        o.description,
        o.place_type as "placeType"
      from organizations o
      left join organization_contacts oc
        on oc.organization_id = o.id
        and oc.active = true
        and oc.is_primary = true
      left join contacts c on c.id = oc.contact_id
      where o.id in (${idList})
    `);
    coreRows = coreResult.rows ?? [];
  } catch (error) {
    reportError?.("core", error);
    coreRows = [];
  }

  let ratingRows: any[] = [];
  try {
    const ratingResult = await execute(sql`
      select
        b.organization_id as id,
        avg(w.rating_stars)::float as "ratingAverage",
        count(w.rating_stars)::int as "ratingCount"
      from bookings b
      inner join event_wrap_ups w on w.booking_id = b.id and w.rating_stars is not null
      where b.organization_id in (${idList})
      group by b.organization_id
    `);
    ratingRows = ratingResult.rows ?? [];
  } catch (error) {
    reportError?.("rating", error);
    ratingRows = [];
  }

  const photosById = new Map(photoRows.map((row) => [row.id, row.profileImageDataUrl ?? null]));
  const coreById = new Map(coreRows.map((row) => [row.id, row]));
  const ratingsById = new Map(ratingRows.map((row) => [row.id, {
    ratingAverage: row.ratingAverage == null ? null : Number(row.ratingAverage),
    ratingCount: Number(row.ratingCount ?? 0),
  }]));

  return new Map(ids.map((id) => {
    const core = coreById.get(id) ?? {};
    const rating = ratingsById.get(id) ?? { ratingAverage: null, ratingCount: 0 };
    return [id, {
      id,
      phone: core.phone ?? null,
      email: core.email ?? null,
      website: core.website ?? null,
      description: core.description ?? null,
      placeType: core.placeType ?? null,
      profileImageDataUrl: photosById.get(id) ?? null,
      ...rating,
    }];
  }));
}

