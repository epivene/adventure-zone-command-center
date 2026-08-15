import { Link } from "wouter";
import type { EventFamilyListRecord } from "@/features/event-families/event-family-types";

export function EventFamilyCard({ family }: { family: EventFamilyListRecord }) {
  return (
    <Link
      href={`/event-families/${family.id}`}
      className="block rounded-xl border border-orange-200 bg-orange-50 p-4 shadow-sm transition hover:border-orange-300 hover:bg-orange-100"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-orange-700">Event family</p>
          <h3 className="mt-1 text-lg font-bold text-slate-900">{family.name}</h3>
          <p className="mt-1 text-sm text-slate-600">
            {family.memberCount} grouped profile{family.memberCount === 1 ? "" : "s"}
          </p>
        </div>
        <span aria-hidden className="text-xl text-orange-700">→</span>
      </div>
    </Link>
  );
}
