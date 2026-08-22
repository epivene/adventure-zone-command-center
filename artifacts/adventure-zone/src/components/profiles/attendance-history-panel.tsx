import { useEffect, useState } from "react";

import { apiGet } from "@/lib/auth-token";
import { officeGet } from "@/lib/office-auth-context";
import {
  AttendanceHistoryCard,
  type ProfileAttendanceHistoryItem,
} from "./attendance-history-card";

export function AttendanceHistoryPanel({
  mode,
  profileId,
}: {
  mode: "owner" | "office";
  profileId: string;
}) {
  const [history, setHistory] = useState<ProfileAttendanceHistoryItem[]>([]);

  useEffect(() => {
    let active = true;
    const load = mode === "office"
      ? officeGet<{ history: ProfileAttendanceHistoryItem[] }>(
          `/office/profiles/${profileId}/attendance-history`,
        )
      : apiGet<{ history: ProfileAttendanceHistoryItem[] }>(
          `/event-profiles/${profileId}/attendance-history`,
        );

    void load
      .then((result) => {
        if (active) setHistory(result.history ?? []);
      })
      .catch(() => {
        if (active) setHistory([]);
      });

    return () => {
      active = false;
    };
  }, [mode, profileId]);

  return <AttendanceHistoryCard history={history} />;
}
