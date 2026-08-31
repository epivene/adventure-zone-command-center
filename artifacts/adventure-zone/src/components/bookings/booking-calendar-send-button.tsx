import React, { useState } from "react";

import {
  syncOperationalCalendarBooking,
  type OperationalCalendarSyncResult,
} from "@/features/google-workspace/operational-calendar-client";

type SyncBooking = (bookingId: string) => Promise<OperationalCalendarSyncResult>;

function resultMessage(result: OperationalCalendarSyncResult): { kind: "success" | "error"; message: string } {
  if (result.state === "synced") {
    return { kind: "success", message: "Sent to Dave's Calendar. Sending it again will update the same calendar event." };
  }
  if (result.state === "review_required") {
    return { kind: "success", message: "Sent to Dave's Calendar. A calendar change is waiting for review." };
  }
  if (result.state === "not_connected") {
    return { kind: "error", message: "Dave's calendar is not connected yet." };
  }
  return {
    kind: "error",
    message: "This event needs confirmed status, dates, a leg, and a package before it can be sent.",
  };
}

export function BookingCalendarSendButton({
  bookingId,
  syncBooking = syncOperationalCalendarBooking,
}: {
  bookingId: string;
  syncBooking?: SyncBooking;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  async function send() {
    setState("sending");
    setFeedback(null);
    try {
      const result = await syncBooking(bookingId);
      const nextFeedback = resultMessage(result);
      setFeedback(nextFeedback);
      setState(nextFeedback.kind === "success" ? "sent" : "idle");
    } catch (error) {
      setFeedback({
        kind: "error",
        message: error instanceof Error ? error.message : "Could not send this event to Dave's calendar.",
      });
      setState("idle");
    }
  }

  return (
    <div className="grid gap-1.5">
      <button
        className="button-secondary text-center"
        disabled={state !== "idle"}
        onClick={() => void send()}
        type="button"
      >
        {state === "sending"
          ? "Sending to Dave's Calendar…"
          : state === "sent"
            ? "Sent to Dave's Calendar"
            : "Send to Dave's Calendar"}
      </button>
      {feedback ? (
        <p
          className={`max-w-xs text-xs font-semibold ${feedback.kind === "success" ? "text-emerald-700" : "text-rose-700"}`}
          role={feedback.kind === "success" ? "status" : "alert"}
        >
          {feedback.message}
        </p>
      ) : null}
    </div>
  );
}
