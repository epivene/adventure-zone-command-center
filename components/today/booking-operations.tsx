import Link from "next/link";

import type { BookingOperationsSummary } from "@/features/bookings/booking-operations-summary";

export function BookingOperations({
  operations,
}: {
  operations: BookingOperationsSummary | null | undefined;
}) {
  if (!operations) return null;
  return (
    <div className="mt-2 grid gap-1 text-xs text-slate-600">
      <p>
        {operations.packageNames.length}{" "}
        {operations.packageNames.length === 1 ? "package" : "packages"} ·{" "}
        {operations.sharedAttractionTotal ?? "No"} attractions
      </p>
      {operations.pendingRequestCount > 0 ? (
        <p className="font-semibold text-amber-800">
          {operations.pendingRequestCount} pending{" "}
          {operations.pendingRequestCount === 1 ? "request" : "requests"}
        </p>
      ) : null}
      {operations.warnings.map((warning) => (
        <Link
          className={
            warning.severity === "blocking"
              ? "font-semibold text-rose-700"
              : "font-semibold text-amber-800"
          }
          href={warning.href}
          key={warning.id}
        >
          {warning.message}
        </Link>
      ))}
    </div>
  );
}
