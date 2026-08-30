from __future__ import annotations

import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"Expected exactly one match in {path}, found {count}: {old[:100]!r}")
    write(path, text.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    text = read(path)
    count = text.count(old)
    if count < minimum:
        raise RuntimeError(f"Expected at least {minimum} matches in {path}, found {count}: {old!r}")
    write(path, text.replace(old, new))


def insert_before_last(path: str, marker: str, addition: str) -> None:
    text = read(path)
    index = text.rfind(marker)
    if index < 0:
        raise RuntimeError(f"Marker not found in {path}: {marker!r}")
    write(path, text[:index] + addition + text[index:])


def add_tests() -> None:
    path = "artifacts/api-server/src/features/follow-ups/single-active-follow-up.pglite.test.ts"
    replace_once(
        path,
        'const bookingId = "30000000-0000-4000-8000-000000000001";\n',
        'const bookingId = "30000000-0000-4000-8000-000000000001";\n'
        'const secondBookingId = "30000000-0000-4000-8000-000000000002";\n',
    )
    insert_before_last(
        path,
        "});\n",
        '''\n  it("replaces an older open follow-up anywhere on the same event profile", async () => {\n    const { client, repository } = await createDatabase();\n    clients.push(client);\n    await client.exec(`\n      insert into bookings (id, organization_id, primary_contact_id, name, city, region)\n        values ('${secondBookingId}', '${organizationId}', '${contactId}', 'Sheridan Celebrates - 2027', 'Sheridan', 'CO');\n    `);\n\n    await repository.create({\n      bookingId,\n      organizationId,\n      contactId,\n      kind: "call current-year organizer",\n      dueAt: new Date("2026-08-30T15:00:00.000Z"),\n    });\n    await repository.create({\n      bookingId: secondBookingId,\n      organizationId,\n      contactId,\n      kind: "follow up next year",\n      dueAt: new Date("2027-01-15T15:00:00.000Z"),\n    });\n\n    const rows = (await client.query(`\n      select booking_id, kind, completed_at, outcome\n      from follow_ups\n      order by created_at, kind\n    `)).rows as Array<{\n      booking_id: string | null;\n      kind: string;\n      completed_at: string | null;\n      outcome: string | null;\n    }>;\n\n    expect(rows.filter((row) => row.completed_at === null)).toEqual([\n      expect.objectContaining({\n        booking_id: secondBookingId,\n        kind: "follow up next year",\n      }),\n    ]);\n    expect(rows.find((row) => row.booking_id === bookingId)).toEqual(\n      expect.objectContaining({ outcome: "Replaced by newer follow-up" }),\n    );\n  });\n''',
    )

    write(
        "artifacts/api-server/src/features/follow-ups/today-profile-followup.pglite.test.ts",
        '''import { PGlite } from "@electric-sql/pglite";\nimport { drizzle } from "drizzle-orm/pglite";\nimport { afterEach, describe, expect, it } from "vitest";\n\nimport * as schema from "@/db/schema";\nimport { needsFollowUpPlanCondition } from "./today-query";\n\nconst organizationId = "10000000-0000-4000-8000-000000000101";\nconst booking2026Id = "30000000-0000-4000-8000-000000000101";\nconst booking2027Id = "30000000-0000-4000-8000-000000000102";\nconst futureBoundary = new Date("2026-08-31T05:00:00.000Z");\nconst startToday = new Date("2026-08-30T05:00:00.000Z");\n\nasync function createDatabase() {\n  const client = new PGlite();\n  await client.exec(`\n    create table bookings (\n      id uuid primary key,\n      organization_id uuid,\n      status text not null,\n      starts_at timestamptz,\n      ends_at timestamptz\n    );\n    create table contacts (\n      id uuid primary key,\n      organization_id uuid\n    );\n    create table follow_ups (\n      id uuid primary key default gen_random_uuid(),\n      booking_id uuid,\n      organization_id uuid,\n      contact_id uuid,\n      kind text not null,\n      due_at timestamptz not null,\n      completed_at timestamptz\n    );\n    insert into bookings (id, organization_id, status, starts_at, ends_at) values\n      ('${booking2026Id}', '${organizationId}', 'new_lead', '2026-09-18T15:00:00Z', '2026-09-19T23:00:00Z'),\n      ('${booking2027Id}', '${organizationId}', 'new_lead', '2027-07-04T15:00:00Z', '2027-07-04T23:00:00Z');\n  `);\n  return { client, database: drizzle(client, { schema }) };\n}\n\nasync function bookingsMissingAPlan(database: ReturnType<typeof drizzle>) {\n  return database\n    .select({ id: schema.bookings.id })\n    .from(schema.bookings)\n    .where(needsFollowUpPlanCondition(futureBoundary, startToday));\n}\n\ndescribe("Today profile-owned next actions", () => {\n  const clients: PGlite[] = [];\n  afterEach(async () => Promise.all(clients.splice(0).map((client) => client.close())));\n\n  it("accepts a future profile-level follow-up as the event's plan", async () => {\n    const { client, database } = await createDatabase();\n    clients.push(client);\n    await client.exec(`\n      insert into follow_ups (organization_id, kind, due_at)\n      values ('${organizationId}', 'Follow up for 2027', '2027-01-15T15:00:00Z');\n    `);\n\n    expect(await bookingsMissingAPlan(database)).toEqual([]);\n  });\n\n  it("accepts a future follow-up attached to another year of the same event", async () => {\n    const { client, database } = await createDatabase();\n    clients.push(client);\n    await client.exec(`\n      insert into follow_ups (booking_id, kind, due_at)\n      values ('${booking2027Id}', 'Follow up for 2027', '2027-01-15T15:00:00Z');\n    `);\n\n    expect(await bookingsMissingAPlan(database)).toEqual([]);\n  });\n});\n''',
    )

    copilot_test = "artifacts/api-server/src/features/follow-ups/today-copilot.test.ts"
    replace_once(
        copilot_test,
        'import {\n  explainFollowUpAction,\n  explainFollowUpPlanAction,\n} from "./today-copilot";\n',
        'import {\n  dedupeFollowUpsByBooking,\n  explainFollowUpAction,\n  explainFollowUpPlanAction,\n} from "./today-copilot";\n',
    )
    insert_before_last(
        copilot_test,
        "});\n",
        '''\n\ndescribe("profile-owned Today follow-ups", () => {\n  it("keeps the newest next action when legacy yearly bookings compete", () => {\n    const staleCurrentTask = followUp({\n      id: "40000000-0000-4000-8000-000000000010",\n      bookingId: "30000000-0000-4000-8000-000000000010",\n      dueAt: new Date("2026-08-18T17:00:00.000Z"),\n      createdAt: new Date("2026-07-17T18:00:00.000Z"),\n    });\n    const nextYearTask = followUp({\n      id: "40000000-0000-4000-8000-000000000011",\n      bookingId: "30000000-0000-4000-8000-000000000011",\n      dueAt: new Date("2027-01-15T15:00:00.000Z"),\n      createdAt: new Date("2026-08-28T18:00:00.000Z"),\n    });\n\n    expect(\n      dedupeFollowUpsByBooking([staleCurrentTask, nextYearTask]).map(({ id }) => id),\n    ).toEqual([nextYearTask.id]);\n  });\n});\n''',
    )

    write(
        "artifacts/api-server/src/features/today/master-work-queue-repository-selection.test.ts",
        '''import { describe, expect, it } from "vitest";\n\nimport { selectCanonicalOpenFollowUp } from "./master-work-queue-repository";\n\ndescribe("master queue profile follow-up selection", () => {\n  it("chooses the newest open instruction and suppresses an older yearly task", () => {\n    const oldTask = {\n      id: "old",\n      dueAt: new Date("2026-08-30T15:00:00.000Z"),\n      createdAt: new Date("2026-07-17T15:00:00.000Z"),\n      completedAt: null,\n    };\n    const futureTask = {\n      id: "future",\n      dueAt: new Date("2027-01-15T15:00:00.000Z"),\n      createdAt: new Date("2026-08-28T15:00:00.000Z"),\n      completedAt: null,\n    };\n\n    expect(selectCanonicalOpenFollowUp([oldTask, futureTask])?.id).toBe("future");\n  });\n});\n''',
    )


def apply_implementation() -> None:
    write(
        "artifacts/api-server/src/features/follow-ups/follow-up-scope.ts",
        '''import { sql } from "drizzle-orm";\n\nimport { bookings, contacts, followUps } from "@/db/schema";\n\n/**\n * Follow-ups belong to the permanent event profile. Booking/contact links are\n * retained as context, but they must not create a second competing task owner.\n * This predicate also recognizes legacy rows that only stored bookingId or\n * contactId and never copied organizationId onto the follow-up itself.\n */\nexport function followUpBelongsToOrganization(organizationId: string) {\n  return sql<boolean>`(\n    ${followUps.organizationId} = ${organizationId}\n    or exists (\n      select 1\n      from ${bookings}\n      where ${bookings.id} = ${followUps.bookingId}\n        and ${bookings.organizationId} = ${organizationId}\n    )\n    or exists (\n      select 1\n      from ${contacts}\n      where ${contacts.id} = ${followUps.contactId}\n        and ${contacts.organizationId} = ${organizationId}\n    )\n  )`;\n}\n''',
    )

    repository = "artifacts/api-server/src/features/follow-ups/follow-up-repository.ts"
    replace_once(
        repository,
        'import { err, ok, type Result } from "@/lib/result";\n',
        'import { followUpBelongsToOrganization } from "@/features/follow-ups/follow-up-scope";\nimport { err, ok, type Result } from "@/lib/result";\n',
    )
    replace_once(
        repository,
        '''      if (input.bookingId) {\n        await transaction\n          .update(followUps)\n          .set({\n            completedAt: now,\n            outcome: "Replaced by newer follow-up",\n            updatedAt: now,\n          })\n          .where(\n            and(\n              eq(followUps.bookingId, input.bookingId),\n              isNull(followUps.completedAt),\n            ),\n          );\n      }\n''',
        '''      await transaction\n        .update(followUps)\n        .set({\n          completedAt: now,\n          outcome: "Replaced by newer follow-up",\n          updatedAt: now,\n        })\n        .where(\n          and(\n            followUpBelongsToOrganization(input.organizationId),\n            isNull(followUps.completedAt),\n          ),\n        );\n''',
    )

    assistant_route = "artifacts/api-server/src/routes/assistant-today-followups.ts"
    replace_once(
        assistant_route,
        'import { requireAssistantImportToken } from "../middlewares/assistant-import-auth";\n',
        'import { followUpBelongsToOrganization } from "@/features/follow-ups/follow-up-scope";\nimport { requireAssistantImportToken } from "../middlewares/assistant-import-auth";\n',
    )
    replace_all(
        assistant_route,
        "eq(followUps.organizationId, organizationId)",
        "followUpBelongsToOrganization(organizationId)",
        minimum=4,
    )

    today_query = "artifacts/api-server/src/features/follow-ups/today-query.ts"
    replace_once(
        today_query,
        '''    notExists(sql`(\n      select 1 from ${followUps}\n      where ${followUps.bookingId} = ${bookings.id}\n        and ${followUps.completedAt} is null\n        and ${followUps.dueAt} >= ${serializedFutureBoundary}\n    )`),\n''',
        '''    notExists(sql`(\n      select 1\n      from follow_ups profile_follow_up\n      left join bookings profile_follow_up_booking\n        on profile_follow_up_booking.id = profile_follow_up.booking_id\n      left join contacts profile_follow_up_contact\n        on profile_follow_up_contact.id = profile_follow_up.contact_id\n      where profile_follow_up.completed_at is null\n        and profile_follow_up.due_at >= ${serializedFutureBoundary}\n        and (\n          profile_follow_up.booking_id = ${bookings.id}\n          or (\n            ${bookings.organizationId} is not null\n            and (\n              profile_follow_up.organization_id = ${bookings.organizationId}\n              or profile_follow_up_booking.organization_id = ${bookings.organizationId}\n              or profile_follow_up_contact.organization_id = ${bookings.organizationId}\n            )\n          )\n        )\n    )`),\n''',
    )

    booking_repository = "artifacts/api-server/src/features/bookings/booking-repository.ts"
    replace_once(
        booking_repository,
        'import { bookingEditPreservesFollowUpPlan } from "@/features/bookings/booking-edit-policy";\n',
        'import { bookingEditPreservesFollowUpPlan } from "@/features/bookings/booking-edit-policy";\nimport { followUpBelongsToOrganization } from "@/features/follow-ups/follow-up-scope";\n',
    )
    replace_once(
        booking_repository,
        '''  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {\n    const [followUp] = await this.database.insert(followUps).values(input).returning();\n    if (!followUp) throw new Error("Could not create follow-up.");\n    return toFollowUp(followUp);\n  }\n''',
        '''  async createFollowUp(input: CreateFollowUpInput): Promise<FollowUp> {\n    const [booking] = await this.database\n      .select({ organizationId: bookings.organizationId })\n      .from(bookings)\n      .where(eq(bookings.id, input.bookingId))\n      .limit(1);\n    if (!booking) throw new Error("Booking is missing.");\n\n    const now = new Date();\n    if (booking.organizationId) {\n      await this.database\n        .update(followUps)\n        .set({\n          completedAt: now,\n          outcome: "Replaced by newer follow-up",\n          updatedAt: now,\n        })\n        .where(\n          and(\n            followUpBelongsToOrganization(booking.organizationId),\n            isNull(followUps.completedAt),\n          ),\n        );\n    } else {\n      await this.database\n        .update(followUps)\n        .set({\n          completedAt: now,\n          outcome: "Replaced by newer follow-up",\n          updatedAt: now,\n        })\n        .where(\n          and(\n            eq(followUps.bookingId, input.bookingId),\n            isNull(followUps.completedAt),\n          ),\n        );\n    }\n\n    const [followUp] = await this.database\n      .insert(followUps)\n      .values({ ...input, organizationId: booking.organizationId })\n      .returning();\n    if (!followUp) throw new Error("Could not create follow-up.");\n    return toFollowUp(followUp);\n  }\n''',
    )
    replace_once(
        booking_repository,
        '''    const [bookingFollowUps, people] = await Promise.all([\n      this.database\n        .select()\n        .from(followUps)\n        .where(eq(followUps.bookingId, bookingId))\n        .orderBy(desc(followUps.dueAt)),\n''',
        '''    const profileFollowUpCondition = record.booking.organizationId\n      ? followUpBelongsToOrganization(record.booking.organizationId)\n      : eq(followUps.bookingId, bookingId);\n    const [bookingFollowUps, people] = await Promise.all([\n      this.database\n        .select()\n        .from(followUps)\n        .where(profileFollowUpCondition)\n        .orderBy(desc(followUps.dueAt)),\n''',
    )

    copilot = "artifacts/api-server/src/features/follow-ups/today-copilot.ts"
    old_dedupe = '''export function dedupeFollowUpsByBooking(items: FollowUpSummary[]): FollowUpSummary[] {\n  const seenBookingIds = new Set<string>();\n  const sorted = [...items].sort((left, right) =>\n    left.dueAt.getTime() - right.dueAt.getTime() ||\n    left.createdAt.getTime() - right.createdAt.getTime() ||\n    left.id.localeCompare(right.id),\n  );\n\n  return sorted.filter((item) => {\n    if (!item.bookingId) return true;\n    if (seenBookingIds.has(item.bookingId)) return false;\n    seenBookingIds.add(item.bookingId);\n    return true;\n  });\n}\n'''
    new_dedupe = '''function followUpOwnerKey(item: FollowUpSummary): string {\n  if (item.organizationId) return `organization:${item.organizationId}`;\n  if (item.bookingId) return `booking:${item.bookingId}`;\n  if (item.contactId) return `contact:${item.contactId}`;\n  return `follow_up:${item.id}`;\n}\n\nexport function dedupeFollowUpsByBooking(items: FollowUpSummary[]): FollowUpSummary[] {\n  const newestByProfile = new Map<string, FollowUpSummary>();\n  for (const item of items) {\n    const key = followUpOwnerKey(item);\n    const current = newestByProfile.get(key);\n    if (\n      !current ||\n      item.createdAt.getTime() > current.createdAt.getTime() ||\n      (item.createdAt.getTime() === current.createdAt.getTime() &&\n        item.id.localeCompare(current.id) > 0)\n    ) {\n      newestByProfile.set(key, item);\n    }\n  }\n\n  return [...newestByProfile.values()].sort((left, right) =>\n    left.dueAt.getTime() - right.dueAt.getTime() ||\n    left.createdAt.getTime() - right.createdAt.getTime() ||\n    left.id.localeCompare(right.id),\n  );\n}\n'''
    replace_once(copilot, old_dedupe, new_dedupe)
    replace_once(
        copilot,
        '''  const followUps = dedupeFollowUpsByBooking(dashboard.followUps);\n  return {\n''',
        '''  const followUps = dedupeFollowUpsByBooking(dashboard.followUps);\n  const [nextCallSource] = dedupeFollowUpsByBooking([\n    ...(dashboard.nextCall ? [dashboard.nextCall] : []),\n    ...followUps,\n  ]);\n  return {\n''',
    )
    replace_once(
        copilot,
        '''    nextCall: dashboard.nextCall\n      ? { ...dashboard.nextCall, copilot: explainFollowUpAction(dashboard.nextCall, now) }\n      : null,\n''',
        '''    nextCall: nextCallSource\n      ? { ...nextCallSource, copilot: explainFollowUpAction(nextCallSource, now) }\n      : null,\n''',
    )

    master = "artifacts/api-server/src/features/today/master-work-queue-repository.ts"
    replace_once(
        master,
        '''  dueAt: Date;\n  completedAt: Date | null;\n  outcome: string | null;\n''',
        '''  dueAt: Date;\n  completedAt: Date | null;\n  createdAt: Date;\n  outcome: string | null;\n''',
    )
    replace_once(
        master,
        '''function candidateFor(\n''',
        '''export function selectCanonicalOpenFollowUp<\n  T extends {\n    id: string;\n    dueAt: Date;\n    completedAt: Date | null;\n    createdAt: Date;\n  },\n>(matching: T[]): T | null {\n  return (\n    [...matching]\n      .filter(({ completedAt }) => completedAt === null)\n      .sort(\n        (left, right) =>\n          right.createdAt.getTime() - left.createdAt.getTime() ||\n          left.dueAt.getTime() - right.dueAt.getTime() ||\n          right.id.localeCompare(left.id),\n      )[0] ?? null\n  );\n}\n\nfunction candidateFor(\n''',
    )
    replace_once(
        master,
        '''      completedAt: followUps.completedAt,\n      outcome: followUps.outcome,\n''',
        '''      completedAt: followUps.completedAt,\n      createdAt: followUps.createdAt,\n      outcome: followUps.outcome,\n''',
    )
    replace_once(
        master,
        '''    const matching = followUpRows\n      .filter(\n        (followUp) =>\n          chooseOpportunity(\n            followUp,\n            byBooking,\n            byContact,\n            byOrganization,\n            currentYear,\n          )?.id === opportunity.id,\n      )\n      .sort(\n        (left, right) =>\n          Number(left.completedAt !== null) - Number(right.completedAt !== null) ||\n          left.dueAt.getTime() - right.dueAt.getTime(),\n      );\n    const open = matching.find(({ completedAt }) => completedAt === null) ?? null;\n    if (open) matchedFollowUps.add(open.id);\n''',
        '''    const matching = followUpRows.filter(\n      (followUp) =>\n        chooseOpportunity(\n          followUp,\n          byBooking,\n          byContact,\n          byOrganization,\n          currentYear,\n        )?.id === opportunity.id,\n    );\n    for (const followUp of matching) matchedFollowUps.add(followUp.id);\n    const open = selectCanonicalOpenFollowUp(matching);\n''',
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=["tests", "implementation"])
    args = parser.parse_args()
    if args.stage == "tests":
        add_tests()
    else:
        apply_implementation()


if __name__ == "__main__":
    main()
