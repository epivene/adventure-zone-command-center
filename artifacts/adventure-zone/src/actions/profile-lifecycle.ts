import { apiGet, apiPost } from "@/lib/auth-token";
import type {
  ArchivedProfileSummary,
  ProfileArchiveState,
} from "@/features/record-lifecycle/profile-lifecycle-types";

export async function getArchivedProfiles(): Promise<ArchivedProfileSummary[]> {
  const response = await apiGet<{ ok: true; profiles: ArchivedProfileSummary[] }>(
    "/profile-lifecycle/archived",
  );
  return response.profiles;
}

export async function archiveProfile(profileId: string): Promise<ProfileArchiveState> {
  const response = await apiPost<{ ok: true; profile: ProfileArchiveState }>(
    `/profile-lifecycle/${profileId}/archive`,
    {},
  );
  return response.profile;
}

export async function restoreProfile(profileId: string): Promise<ProfileArchiveState> {
  const response = await apiPost<{ ok: true; profile: ProfileArchiveState }>(
    `/profile-lifecycle/${profileId}/restore`,
    {},
  );
  return response.profile;
}
