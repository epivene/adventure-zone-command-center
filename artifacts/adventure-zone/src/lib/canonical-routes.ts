function query(search?: string) {
  return new URLSearchParams(search?.startsWith("?") ? search.slice(1) : search ?? "");
}

function appendFirst(target: URLSearchParams, source: URLSearchParams, key: string) {
  const value = source.get(key);
  if (value) target.set(key, value);
}

function withSearch(path: string, params: URLSearchParams) {
  const value = params.toString();
  return value ? `${path}?${value}` : path;
}

export function canonicalCallsPath(search = "") {
  const source = query(search);
  const target = new URLSearchParams();
  for (const key of ["mode", "contactId", "organizationId", "bookingId", "followUpId", "action", "phone", "q"] as const) {
    appendFirst(target, source, key);
  }
  return withSearch("/calls/workspace", target);
}

export function canonicalCallLogPath(search = "") {
  const source = query(search);
  const target = new URLSearchParams();
  for (const key of ["contactId", "organizationId", "bookingId", "followUpId", "action"] as const) {
    appendFirst(target, source, key);
  }
  return withSearch("/calls/log", target);
}

export function canonicalSchedulePath(input: {
  view?: "calendar" | "map";
  search?: string;
} = {}) {
  const source = query(input.search);
  const target = new URLSearchParams();
  const view = input.view ?? (source.get("view") === "map" ? "map" : "calendar");
  if (view === "map") target.set("view", "map");
  for (const key of ["season", "leg", "status"] as const) appendFirst(target, source, key);
  return withSearch("/schedule", target);
}

export function canonicalProfilesPath(search = "") {
  const source = query(search);
  const target = new URLSearchParams();
  for (const key of ["type", "q", "page", "pageSize", "showMembers"] as const) appendFirst(target, source, key);
  return withSearch("/profiles", target);
}

export function canonicalProfilePath(id: string) {
  return `/profiles/${encodeURIComponent(id)}`;
}

export function canonicalActMigrationPath(search = "") {
  const params = query(search);
  return withSearch("/settings/act-migration", params);
}
