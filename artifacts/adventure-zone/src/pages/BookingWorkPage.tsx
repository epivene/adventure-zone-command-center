import { useSearch } from "wouter";
import { WorkQueue } from "@/features/booking-work/WorkQueue";

export default function BookingWorkPage() {
  const search = useSearch();
  const value = new URLSearchParams(search).get("profileId");
  const profileId = value && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value) ? value : undefined;
  return <div className="mx-auto grid max-w-5xl gap-4">
    <h1 className="text-2xl font-semibold">Shared booking work</h1>
    <p className="text-sm text-muted-foreground">Use Edit work → Hand off to → Change assignment to release a card or choose its next owner. Progress and review links stay with the existing card.</p>
    {profileId ? <a className="underline" href="/settings/booking-work">Show all work</a> : null}
    <WorkQueue profileId={profileId} />
  </div>;
}
