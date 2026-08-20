import { Link } from "wouter";

import { ProfileLastResortButton } from "@/components/profiles/profile-last-resort-action";

type Props = {
  profileId: string;
  selectedContactId?: string | null;
  bookingId?: string;
  followUpId?: string;
  mode?: "prospect";
  assistedCallingEnabled: boolean;
  callablePhone?: string | null;
  onEdit(): void;
};

function callHref({
  profileId,
  selectedContactId,
  bookingId,
  followUpId,
  mode,
  route,
}: Omit<Props, "assistedCallingEnabled" | "callablePhone" | "onEdit"> & { route: "/calls/new" | "/calls/log" }) {
  const query = new URLSearchParams({ organizationId: profileId });
  if (selectedContactId) query.set("contactId", selectedContactId);
  if (bookingId) query.set("bookingId", bookingId);
  if (followUpId) query.set("followUpId", followUpId);
  if (mode) query.set("mode", mode);
  return `${route}?${query.toString()}`;
}

export function ProfilePrimaryActions(props: Props) {
  const { profileId, selectedContactId, bookingId, followUpId, mode, callablePhone, onEdit } = props;
  const shared = { profileId, selectedContactId, bookingId, followUpId, mode };
  const newCallHref = callHref({ ...shared, route: "/calls/new" });
  const logCallHref = callHref({ ...shared, route: "/calls/log" });

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm" aria-label="Profile primary actions">
      {callablePhone ? <Link className="button-primary" href={newCallHref}>Call</Link> : <button className="button-primary" disabled type="button">Call</button>}
      <Link className="button-secondary" href={logCallHref}>Log call</Link>
      <button className="button-secondary" type="button" onClick={onEdit}>Edit profile</button>
      <ProfileLastResortButton profileId={profileId} />
      <Link className="button-secondary" href="/event-profiles/new">Add Event / Lead</Link>
    </div>
  );
}
