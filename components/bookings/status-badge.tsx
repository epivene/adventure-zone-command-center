import type { BookingStatus } from "@/features/bookings/booking-types";

const statusTone: Record<BookingStatus, string> = {
  new_lead: "bg-sky-100 text-sky-800",
  researching: "bg-violet-100 text-violet-800",
  contact_due: "bg-orange-100 text-orange-900",
  contacted: "bg-blue-100 text-blue-800",
  interested: "bg-emerald-100 text-emerald-800",
  possible: "bg-amber-100 text-amber-900",
  unlikely: "bg-slate-200 text-slate-700",
  quote_sent: "bg-cyan-100 text-cyan-800",
  pending_decision: "bg-yellow-100 text-yellow-900",
  pending_contract: "bg-indigo-100 text-indigo-800",
  contract_received: "bg-teal-100 text-teal-800",
  confirmed: "bg-green-100 text-green-800",
  declined: "bg-slate-200 text-slate-700",
  cancelled: "bg-rose-100 text-rose-800",
  completed: "bg-slate-200 text-slate-700",
  renewal_due: "bg-fuchsia-100 text-fuchsia-800",
};

export function formatBookingStatus(status: BookingStatus) {
  return status
    .split("_")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

export function StatusBadge({ status }: { status: BookingStatus }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${statusTone[status]}`}
    >
      {formatBookingStatus(status)}
    </span>
  );
}
