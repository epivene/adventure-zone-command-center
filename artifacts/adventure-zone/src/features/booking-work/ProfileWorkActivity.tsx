import { WorkQueue } from "./WorkQueue";
import { useSearch } from "wouter";
import { WorkRecordReview } from "./WorkRecordReview";
export function ProfileWorkActivity({ profileId }: { profileId: string }) {
  const params = new URLSearchParams(useSearch());
  return (
    <div className="rounded-xl border bg-card p-4">
      <WorkRecordReview
        profileId={profileId}
        kind={params.get("workReview")}
        recordId={params.get("recordId")}
      />
      <WorkQueue key={profileId} profileId={profileId} />
    </div>
  );
}
