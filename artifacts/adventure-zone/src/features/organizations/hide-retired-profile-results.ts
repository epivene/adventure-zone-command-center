type ProfileRecord = {
  parentContext?: { kind?: string } | null;
};

type ProfilePage<T extends ProfileRecord = ProfileRecord> = {
  records: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  pageCount?: number;
  [key: string]: unknown;
};

export function hideRetiredProfileResults<T extends ProfileRecord>(
  page: ProfilePage<T>,
  includeRetired: boolean,
): ProfilePage<T> {
  if (includeRetired || !Array.isArray(page?.records)) return page;
  const records = page.records.filter(
    (record) => record.parentContext?.kind !== "organization_group",
  );
  return { ...page, records };
}
