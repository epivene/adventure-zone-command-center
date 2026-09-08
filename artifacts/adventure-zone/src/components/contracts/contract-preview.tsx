import type { ContractValues } from "@/features/contracts/contract-types";

export function ContractPreview({ values }: { values: ContractValues }) {
  return (
    <section aria-label="Contract preview" className="grid gap-2 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm">
      <h2 className="text-lg font-bold">Agreement preview</h2>
      <p><strong>{values.eventName}</strong> for {values.organizationName}</p>
      <p>{values.venueName}, {values.venueAddress.city}, {values.venueAddress.region} · {values.eventStartDate} through {values.eventEndDate}</p>
      <p>Arrangement: {values.arrangement.replaceAll("_", " ")}</p>
      <ol className="list-decimal pl-5">
        <li>{values.eventSigner.name} — {values.eventSigner.role}</li>
        <li>{values.internalSigner.name} — {values.internalSigner.role}</li>
      </ol>
      <p className="text-slate-600">The generated PDF includes separate signature and date lines in this order.</p>
    </section>
  );
}
