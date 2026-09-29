import type { Selection } from "./types";
export function profileSelection(profileId?: string): Selection {
  return {
    organizationIds: profileId ? [profileId] : [],
    bookingId: null,
    threadId: null,
    draftId: null,
    batchId: null,
    eventYear: null,
  };
}
