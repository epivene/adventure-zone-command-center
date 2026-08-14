import { eq, isNull } from "drizzle-orm";
import type { db as applicationDatabase } from "@/db/client";
import { contacts, organizations } from "@/db/schema";
import { applyConsolidation } from "./organization-consolidation";

export type ImportedLocationFamilyRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  email: string | null;
  website?: string | null;
};

export type ImportedLocationAssignment = {
  sourceOrgId: string;
  label: string;
};

export type ImportedLocationFamily = {
  key: string;
  canonicalName: string;
  canonicalOrgId: string | null;
  locations: ImportedLocationAssignment[];
};

const publicEmailDomains = new Set([
  "aol.com",
  "gmail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
]);

function tokens(value: string): string[] {
  return value.match(/[a-z0-9]+/gi) ?? [];
}

function normalized(value: string): string {
  return value.toLocaleLowerCase("en-US");
}

function emailDomain(email: string | null): string | null {
  const value = email?.trim().toLocaleLowerCase("en-US") ?? "";
  const at = value.lastIndexOf("@");
  if (at <= 0 || at === value.length - 1) return null;
  const domain = value.slice(at + 1);
  if (
    publicEmailDomains.has(domain) ||
    domain.endsWith(".gov") ||
    domain.endsWith(".edu")
  ) {
    return null;
  }
  return domain;
}

function websiteDomain(website: string | null | undefined): string | null {
  const value = website?.trim();
  if (!value) return null;
  try {
    const hostname = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`,
    ).hostname
      .toLocaleLowerCase("en-US")
      .replace(/^www\./, "");
    if (!hostname || hostname.endsWith(".gov") || hostname.endsWith(".edu")) {
      return null;
    }
    return hostname;
  } catch {
    return null;
  }
}

function locationLabel(
  row: ImportedLocationFamilyRow,
  prefixLength: number,
): string {
  const recorded = [row.city?.trim(), row.region?.trim()].filter(Boolean);
  if (recorded.length) return recorded.join(", ");
  return tokens(row.name).slice(prefixLength).join(" ");
}

export function detectImportedLocationFamilies(
  rows: readonly ImportedLocationFamilyRow[],
): ImportedLocationFamily[] {
  const candidateGroups = new Map<
    string,
    Map<string, ImportedLocationFamilyRow>
  >();

  for (const row of rows) {
    const nameTokens = tokens(row.name);
    if (nameTokens.length < 3) continue;
    const seed = nameTokens.slice(0, 2).map(normalized).join("-");
    const domains = new Set([
      emailDomain(row.email),
      websiteDomain(row.website),
    ]);
    for (const domain of domains) {
      if (!domain) continue;
      const key = `${domain}:${seed}`;
      const organizationsForKey = candidateGroups.get(key) ?? new Map();
      organizationsForKey.set(row.id, row);
      candidateGroups.set(key, organizationsForKey);
    }
  }

  const detected: ImportedLocationFamily[] = [];
  for (const [seedKey, byOrganization] of candidateGroups) {
    const records = [...byOrganization.values()].sort((left, right) =>
      left.id.localeCompare(right.id, "en-US"),
    );
    if (records.length < 3) continue;

    const tokenLists = records.map((record) => tokens(record.name));
    const shortest = Math.min(...tokenLists.map((list) => list.length));
    let commonPrefixLength = 0;
    for (let index = 0; index < shortest; index += 1) {
      const values = new Set(
        tokenLists.map((list) => normalized(list[index] ?? "")),
      );
      if (values.size !== 1) break;
      commonPrefixLength += 1;
    }
    if (commonPrefixLength < 3) continue;

    const domain = seedKey.slice(0, seedKey.indexOf(":"));
    const domainRoot = normalized(domain.split(".")[0] ?? "").replace(
      /[^a-z0-9]/g,
      "",
    );
    const canonicalCompact = tokenLists[0]!
      .slice(0, commonPrefixLength)
      .map(normalized)
      .join("");
    if (
      !domainRoot.includes(canonicalCompact) &&
      !canonicalCompact.includes(domainRoot)
    ) {
      continue;
    }

    const canonicalName = tokenLists[0]!.slice(0, commonPrefixLength).join(" ");
    const existingCanonical = records.find(
      (record) => tokens(record.name).length === commonPrefixLength,
    );
    const locations = records
      .filter((record) => record.id !== existingCanonical?.id)
      .map((record) => ({
        sourceOrgId: record.id,
        label: locationLabel(record, commonPrefixLength),
      }))
      .filter((assignment) => assignment.label.length > 0);
    if (locations.length < 2) continue;

    detected.push({
      key: `${domain}:${tokenLists[0]!
        .slice(0, commonPrefixLength)
        .map(normalized)
        .join("-")}`,
      canonicalName,
      canonicalOrgId: existingCanonical?.id ?? null,
      locations,
    });
  }

  const claimedOrganizations = new Set<string>();
  return detected
    .sort(
      (left, right) =>
        right.locations.length - left.locations.length ||
        left.key.localeCompare(right.key, "en-US"),
    )
    .filter((family) => {
      const ids = [
        family.canonicalOrgId,
        ...family.locations.map((item) => item.sourceOrgId),
      ].filter((id): id is string => Boolean(id));
      if (ids.some((id) => claimedOrganizations.has(id))) return false;
      ids.forEach((id) => claimedOrganizations.add(id));
      return true;
    });
}

export function splitLocationFamilyAssignments(
  assignments: readonly ImportedLocationAssignment[],
): ImportedLocationAssignment[][] {
  const remaining = Array.from(assignments);
  const batches: ImportedLocationAssignment[][] = [];
  while (remaining.length) {
    let size = Math.min(20, remaining.length);
    if (remaining.length - size === 1) size -= 1;
    batches.push(remaining.splice(0, size));
  }
  return batches;
}

export async function autoConsolidateImportedLocationFamilies(
  database: typeof applicationDatabase,
  now: Date,
): Promise<{ families: number; locations: number }> {
  const rows = await database
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      region: organizations.region,
      email: contacts.email,
      website: organizations.website,
    })
    .from(organizations)
    .leftJoin(contacts, eq(contacts.organizationId, organizations.id))
    .where(isNull(organizations.consolidatedIntoId));

  const families = detectImportedLocationFamilies(rows);
  let locationCount = 0;
  for (const family of families) {
    let canonicalOrgId = family.canonicalOrgId;
    for (const assignments of splitLocationFamilyAssignments(
      family.locations,
    )) {
      const result = await applyConsolidation(
        database,
        {
          canonicalOrgId,
          proposedCanonical: canonicalOrgId
            ? undefined
            : { name: family.canonicalName },
          locationAssignments: assignments,
        },
        now,
      );
      canonicalOrgId = result.canonicalOrgId;
      locationCount += assignments.length;
    }
  }

  return { families: families.length, locations: locationCount };
}
