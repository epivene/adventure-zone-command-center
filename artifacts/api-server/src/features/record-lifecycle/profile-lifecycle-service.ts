import type { db as applicationDatabase } from "@/db/client";
import {
  ProfileLifecycleRepository,
  type ArchivedProfileSummary,
  type ProfileArchiveState,
} from "./profile-lifecycle-repository";

type DrizzleDatabase = typeof applicationDatabase;

export class ProfileLifecycleService {
  private readonly repository: ProfileLifecycleRepository;

  constructor(database: DrizzleDatabase) {
    this.repository = new ProfileLifecycleRepository(database);
  }

  archive(profileId: string, actorId: string | null): Promise<ProfileArchiveState> {
    return this.repository.archive(profileId, actorId);
  }

  restore(profileId: string, actorId: string | null): Promise<ProfileArchiveState> {
    return this.repository.restore(profileId, actorId);
  }

  listArchived(): Promise<ArchivedProfileSummary[]> {
    return this.repository.listArchived();
  }
}
