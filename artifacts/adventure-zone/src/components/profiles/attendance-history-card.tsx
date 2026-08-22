export type ProfileAttendanceHistoryItem = {
  id: string;
  year: number;
  month: string;
  status: "attended" | "blacklisted" | "cancelled_last_minute";
  sourceEventName: string;
  sourceLocation: string;
  organizationLocationId: string | null;
};

const statusLabel: Record<ProfileAttendanceHistoryItem["status"], string> = {
  attended: "Attended",
  blacklisted: "Blacklisted",
  cancelled_last_minute: "Cancelled last minute",
};

export function AttendanceHistoryCard({
  history,
}: {
  history: ProfileAttendanceHistoryItem[];
}) {
  if (!history.length) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Business history</p>
        <h2 className="mt-1 text-xl font-bold">Attendance history</h2>
        <p className="mt-1 text-sm text-slate-600">
          Historical event attendance from reviewed source records.
        </p>
      </div>
      <ul className="mt-3 grid gap-2">
        {history.map((item) => (
          <li className="rounded-xl border border-slate-200 bg-slate-50 p-3" key={item.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{item.year} · {statusLabel[item.status]}</p>
                <p className="mt-1 text-sm text-slate-600">{item.month} · {item.sourceLocation}</p>
              </div>
              {item.sourceEventName ? (
                <span className="text-xs font-medium text-slate-500">{item.sourceEventName}</span>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
