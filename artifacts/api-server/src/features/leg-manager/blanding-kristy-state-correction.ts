import { pool as defaultPool } from "@workspace/db";

export type ManagerLegMatch = {
  legId: string;
  managerName: string | null;
  legName: string;
};

export type BlandingStateInspection = {
  bookingId: string;
  organizationId: string;
  bookingName: string;
  city: string;
  region: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  probability: string | null;
  assignedLegId: string | null;
  latitude: number | null;
  longitude: number | null;
  gmailThreadLinked: boolean;
  contacts: string[];
};

export type BlandingContact = {
  firstName: string;
  lastName: string;
  email: string;
};

export const BLANDING_2026_GMAIL = {
  accountEmail: "theadventurezone12@gmail.com",
  messageId: "1a0396226f98017b",
  threadId: "19d214e0a6d3f255",
} as const;

export const BLANDING_2026_CONTACTS: readonly BlandingContact[] = [
  { firstName: "Alyn", lastName: "Mitchell", email: "amitchell@sanjuancc.org" },
  { firstName: "Shauna", lastName: "Sherrow", email: "ssherrow@sanjuancc.org" },
] as const;

export const BLANDING_2026_COORDINATES = {
  latitude: 37.6242,
  longitude: -109.4782,
} as const;

const correctionReason =
  "Owner confirmed Blanding belongs to Kristy's leg and its Adventure Zone Gmail history belongs on the event profile.";

export interface BlandingKristyStateCorrectionRepository {
  findKristyLegs(): Promise<ManagerLegMatch[]>;
  inspectBlanding2026(): Promise<BlandingStateInspection[]>;
  applyCorrection(input: {
    expected: BlandingStateInspection;
    legId: string;
    gmail: typeof BLANDING_2026_GMAIL;
    contacts: BlandingContact[];
    coordinates: typeof BLANDING_2026_COORDINATES;
    reason: string;
  }): Promise<"applied" | "already_current" | "changed">;
}

export async function correctBlandingKristyState(
  repository: BlandingKristyStateCorrectionRepository =
    new PostgresBlandingKristyStateCorrectionRepository(),
): Promise<
  | {
      status: "applied" | "already_current";
      bookingId: string;
      organizationId: string;
      legId: string;
      gmailThreadId: string;
      contacts: string[];
      mapReady: true;
    }
  | { status: "skipped"; reason: string; details?: unknown }
> {
  const legs = await repository.findKristyLegs();
  if (legs.length !== 1) {
    return { status: "skipped", reason: "manager_ambiguous", details: legs };
  }

  const matches = await repository.inspectBlanding2026();
  if (matches.length !== 1) {
    return {
      status: "skipped",
      reason: "booking_ambiguous",
      details: matches.map((booking) => ({
        bookingId: booking.bookingId,
        organizationId: booking.organizationId,
        bookingName: booking.bookingName,
        startsAt: booking.startsAt,
        endsAt: booking.endsAt,
      })),
    };
  }

  const expected = matches[0]!;
  const result = await repository.applyCorrection({
    expected,
    legId: legs[0]!.legId,
    gmail: BLANDING_2026_GMAIL,
    contacts: [...BLANDING_2026_CONTACTS],
    coordinates: BLANDING_2026_COORDINATES,
    reason: correctionReason,
  });
  if (result === "changed") {
    return { status: "skipped", reason: "state_changed_during_correction" };
  }

  return {
    status: result,
    bookingId: expected.bookingId,
    organizationId: expected.organizationId,
    legId: legs[0]!.legId,
    gmailThreadId: BLANDING_2026_GMAIL.threadId,
    contacts: BLANDING_2026_CONTACTS.map((contact) => contact.email),
    mapReady: true,
  };
}

type QueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
  rowCount?: number | null;
};

type QueryExecutor = {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
};

type QueryClient = QueryExecutor & { release(): void };
type QueryPool = QueryExecutor & { connect(): Promise<QueryClient> };

type BookingRow = {
  booking_id: string;
  organization_id: string;
  booking_name: string;
  city: string;
  region: string;
  starts_at: Date | string;
  ends_at: Date | string;
  status: string;
  probability: string | null;
  travel_leg_id: string | null;
  latitude: number | string | null;
  longitude: number | string | null;
  gmail_thread_linked: boolean;
  contact_emails: string[] | null;
};

function nullableNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function inspection(row: BookingRow): BlandingStateInspection {
  return {
    bookingId: row.booking_id,
    organizationId: row.organization_id,
    bookingName: row.booking_name,
    city: row.city,
    region: row.region,
    startsAt: new Date(row.starts_at),
    endsAt: new Date(row.ends_at),
    status: row.status,
    probability: row.probability,
    assignedLegId: row.travel_leg_id,
    latitude: nullableNumber(row.latitude),
    longitude: nullableNumber(row.longitude),
    gmailThreadLinked: row.gmail_thread_linked,
    contacts: row.contact_emails ?? [],
  };
}

function sameBooking(
  row: Omit<BookingRow, "gmail_thread_linked" | "contact_emails">,
  expected: BlandingStateInspection,
) {
  return row.booking_id === expected.bookingId
    && row.organization_id === expected.organizationId
    && row.booking_name === expected.bookingName
    && row.city === expected.city
    && row.region === expected.region
    && new Date(row.starts_at).toISOString() === expected.startsAt.toISOString()
    && new Date(row.ends_at).toISOString() === expected.endsAt.toISOString()
    && row.status === expected.status
    && row.probability === expected.probability
    && row.travel_leg_id === expected.assignedLegId
    && nullableNumber(row.latitude) === expected.latitude
    && nullableNumber(row.longitude) === expected.longitude;
}

async function ensureContact(
  client: QueryClient,
  input: {
    organizationId: string;
    bookingId: string;
    contact: BlandingContact;
  },
): Promise<string | null> {
  const existing = await client.query<{
    id: string;
    email: string | null;
  }>(
    `SELECT contact.id, contact.email
       FROM contacts contact
      WHERE lower(trim(contact.first_name)) = lower($2)
        AND lower(trim(contact.last_name)) = lower($3)
        AND (
          contact.organization_id = $1
          OR EXISTS (
            SELECT 1
              FROM organization_contacts relationship
             WHERE relationship.organization_id = $1
               AND relationship.contact_id = contact.id
          )
        )
      ORDER BY contact.id
      FOR UPDATE`,
    [input.organizationId, input.contact.firstName, input.contact.lastName],
  );
  if (existing.rows.length > 1) return null;

  let contactId: string;
  const current = existing.rows[0];
  if (current) {
    if (
      current.email
      && current.email.trim().toLowerCase() !== input.contact.email.toLowerCase()
    ) {
      return null;
    }
    contactId = current.id;
    await client.query(
      `UPDATE contacts
          SET email = $2,
              updated_at = now()
        WHERE id = $1`,
      [contactId, input.contact.email],
    );
  } else {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO contacts
         (organization_id, first_name, last_name, email)
       VALUES (NULL, $1, $2, $3)
       RETURNING id`,
      [input.contact.firstName, input.contact.lastName, input.contact.email],
    );
    contactId = inserted.rows[0]!.id;
  }

  await client.query(
    `INSERT INTO organization_contacts
       (organization_id, contact_id, role, is_primary, active, source)
     VALUES ($1, $2, 'Event contact', false, true, 'local')
     ON CONFLICT (organization_id, contact_id)
     DO UPDATE SET active = true, updated_at = now()`,
    [input.organizationId, contactId],
  );
  await client.query(
    `UPDATE contacts
        SET organization_id = $2,
            updated_at = now()
      WHERE id = $1
        AND organization_id IS DISTINCT FROM $2`,
    [contactId, input.organizationId],
  );
  await client.query(
    `INSERT INTO booking_contacts
       (booking_id, contact_id, role, is_primary, source)
     VALUES ($1, $2, 'Event contact', false, 'local')
     ON CONFLICT (booking_id, contact_id)
     DO UPDATE SET role = EXCLUDED.role, updated_at = now()`,
    [input.bookingId, contactId],
  );
  return contactId;
}

export class PostgresBlandingKristyStateCorrectionRepository
implements BlandingKristyStateCorrectionRepository {
  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}

  async findKristyLegs(): Promise<ManagerLegMatch[]> {
    const result = await this.pool.query<{
      leg_id: string;
      manager_name: string | null;
      leg_name: string;
    }>(
      `SELECT access.leg_id, access.manager_name, leg.name AS leg_name
         FROM leg_manager_access access
         JOIN travel_legs leg ON leg.id = access.leg_id
        WHERE lower(trim(coalesce(access.manager_name, ''))) = 'kristy'
          AND leg.archived_at IS NULL
        ORDER BY access.leg_id`,
    );
    return result.rows.map((row) => ({
      legId: row.leg_id,
      managerName: row.manager_name,
      legName: row.leg_name,
    }));
  }

  async inspectBlanding2026(): Promise<BlandingStateInspection[]> {
    const result = await this.pool.query<BookingRow>(
      `SELECT booking.id AS booking_id,
              booking.organization_id,
              booking.name AS booking_name,
              booking.city,
              booking.region,
              booking.starts_at,
              booking.ends_at,
              booking.status::text AS status,
              booking.probability::text AS probability,
              booking.travel_leg_id,
              booking.latitude,
              booking.longitude,
              EXISTS (
                SELECT 1
                  FROM google_workspace_validation_mappings mapping
                 WHERE mapping.organization_id = booking.organization_id
                   AND mapping.thread_id = $1
              ) AS gmail_thread_linked,
              ARRAY(
                SELECT lower(trim(contact.email))
                  FROM contacts contact
                 WHERE contact.organization_id = booking.organization_id
                   AND contact.email IS NOT NULL
                 ORDER BY lower(trim(contact.email))
              ) AS contact_emails
         FROM bookings booking
        WHERE booking.organization_id IS NOT NULL
          AND lower(trim(booking.name)) IN (
            'blanding city fall festival',
            'blanding fall festival'
          )
          AND lower(trim(booking.city)) = 'blanding'
          AND upper(trim(booking.region)) = 'UT'
          AND booking.starts_at IS NOT NULL
          AND booking.ends_at IS NOT NULL
          AND booking.starts_at < '2026-09-13T00:00:00.000Z'::timestamptz
          AND booking.ends_at >= '2026-09-12T00:00:00.000Z'::timestamptz
        ORDER BY booking.id`,
      [BLANDING_2026_GMAIL.threadId],
    );
    return result.rows.map(inspection);
  }

  async applyCorrection(input: {
    expected: BlandingStateInspection;
    legId: string;
    gmail: typeof BLANDING_2026_GMAIL;
    contacts: BlandingContact[];
    coordinates: typeof BLANDING_2026_COORDINATES;
    reason: string;
  }): Promise<"applied" | "already_current" | "changed"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<
        Omit<BookingRow, "gmail_thread_linked" | "contact_emails">
      >(
        `SELECT id AS booking_id,
                organization_id,
                name AS booking_name,
                city,
                region,
                starts_at,
                ends_at,
                status::text AS status,
                probability::text AS probability,
                travel_leg_id,
                latitude,
                longitude
           FROM bookings
          WHERE id = $1
          FOR UPDATE`,
        [input.expected.bookingId],
      );
      const row = locked.rows[0];
      if (!row || !sameBooking(row, input.expected)) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const connections = await client.query<{ id: string }>(
        `SELECT id
           FROM google_workspace_connections
          WHERE lower(trim(account_email)) = lower($1)
            AND role = 'workspace'
            AND status = 'connected'
          ORDER BY id
          FOR UPDATE`,
        [input.gmail.accountEmail],
      );
      if (connections.rows.length !== 1) {
        await client.query("ROLLBACK");
        return "changed";
      }

      const contactIds: string[] = [];
      for (const contact of input.contacts) {
        const contactId = await ensureContact(client, {
          organizationId: input.expected.organizationId,
          bookingId: input.expected.bookingId,
          contact,
        });
        if (!contactId) {
          await client.query("ROLLBACK");
          return "changed";
        }
        contactIds.push(contactId);
      }

      await client.query(
        `UPDATE bookings
            SET travel_leg_id = $2,
                status = 'confirmed',
                probability = 'definite',
                latitude = coalesce(latitude, $3),
                longitude = coalesce(longitude, $4),
                updated_at = now()
          WHERE id = $1`,
        [
          input.expected.bookingId,
          input.legId,
          input.coordinates.latitude,
          input.coordinates.longitude,
        ],
      );
      await client.query(
        `INSERT INTO booking_leg_assignments
           (booking_id, assigned_leg_id, suggested_leg_id, source, explanation, confidence)
         VALUES ($1, $2, $2, 'manual', $3, 'high')
         ON CONFLICT (booking_id)
         DO UPDATE SET assigned_leg_id = EXCLUDED.assigned_leg_id,
                       suggested_leg_id = EXCLUDED.suggested_leg_id,
                       source = 'manual',
                       explanation = EXCLUDED.explanation,
                       warning = NULL,
                       confidence = 'high',
                       updated_at = now()`,
        [input.expected.bookingId, input.legId, input.reason],
      );
      await client.query(
        `INSERT INTO google_workspace_validation_mappings
           (connection_id, message_id, thread_id, organization_id, contact_id, evidence_codes, updated_at)
         VALUES ($1, $2, $3, $4, $5, '["assistant_approved_gmail_profile_link","exact_contact_email"]'::jsonb, now())
         ON CONFLICT (connection_id, message_id)
         DO UPDATE SET thread_id = EXCLUDED.thread_id,
                       organization_id = EXCLUDED.organization_id,
                       contact_id = EXCLUDED.contact_id,
                       evidence_codes = EXCLUDED.evidence_codes,
                       updated_at = now()`,
        [
          connections.rows[0]!.id,
          input.gmail.messageId,
          input.gmail.threadId,
          input.expected.organizationId,
          contactIds[0]!,
        ],
      );
      await client.query(
        `INSERT INTO audit_entries
           (entity_type, entity_id, action, before, after)
         VALUES (
           'booking',
           $1,
           'blanding_kristy_live_state_corrected',
           jsonb_build_object(
             'travelLegId', $2::text,
             'status', $3::text,
             'probability', $4::text,
             'gmailThreadLinked', $5::boolean,
             'reason', $6::text
           ),
           jsonb_build_object(
             'travelLegId', $7::text,
             'status', 'confirmed',
             'probability', 'definite',
             'gmailThreadId', $8::text,
             'contactEmails', $9::text[],
             'mapReady', true
           )
         )`,
        [
          input.expected.bookingId,
          input.expected.assignedLegId,
          input.expected.status,
          input.expected.probability,
          input.expected.gmailThreadLinked,
          input.reason,
          input.legId,
          input.gmail.threadId,
          input.contacts.map((contact) => contact.email),
        ],
      );
      await client.query("COMMIT");

      const wasCurrent =
        input.expected.assignedLegId === input.legId
        && input.expected.status === "confirmed"
        && input.expected.probability === "definite"
        && input.expected.gmailThreadLinked
        && input.expected.latitude !== null
        && input.expected.longitude !== null
        && input.contacts.every((contact) =>
          input.expected.contacts.includes(contact.email.toLowerCase()));
      return wasCurrent ? "already_current" : "applied";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
