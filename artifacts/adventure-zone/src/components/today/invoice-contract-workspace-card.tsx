import { Link } from "wouter";

export function InvoiceContractWorkspaceCard() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" aria-labelledby="invoice-contract-workspace-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-950" id="invoice-contract-workspace-title">Invoices &amp; Contracts</h3>
          <p className="mt-1 text-sm text-slate-600">Manage invoices, deposits, balances, and signed contracts together.</p>
        </div>
        <Link
          className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-bold text-white hover:bg-orange-700"
          href="/invoices-contracts"
        >
          Open workspace
        </Link>
      </div>
    </section>
  );
}
