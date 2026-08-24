import { apiFetch } from "@/lib/auth-token";

export type GoogleReviewProfileSearchResult = {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
};

export async function searchGoogleReviewProfiles(
  query: string,
): Promise<GoogleReviewProfileSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const response = await apiFetch(
    `/organizations?q=${encodeURIComponent(q)}&page=1&pageSize=8&includeRetired=false`,
  );
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error("Could not search profiles.");
  const records =
    body &&
    typeof body === "object" &&
    "organizations" in body &&
    body.organizations &&
    typeof body.organizations === "object" &&
    "records" in body.organizations &&
    Array.isArray(body.organizations.records)
      ? body.organizations.records
      : [];
  return records.flatMap((record: unknown) => {
    if (!record || typeof record !== "object") return [];
    const value = record as Record<string, unknown>;
    if (typeof value.id !== "string" || typeof value.name !== "string") return [];
    return [{
      id: value.id,
      name: value.name,
      city: typeof value.city === "string" ? value.city : null,
      region: typeof value.region === "string" ? value.region : null,
    }];
  });
}
