import { Card, CardContent } from "@workspace/avz-crm/components/ui/card";
import { formatCents, type RecordsResponse } from "@/features/agent-tax/client";

export function SummaryCards({ summary, year }: { summary: RecordsResponse["summary"]; year: number | null }) {
  const items = [
    ["Income", summary.incomeCents], ["Expenses", summary.expenseCents], ["Income minus expenses", summary.netCents],
  ] as const;
  return (
    <section aria-label={`Totals for ${year ?? "selected year"}`} className="grid gap-3 sm:grid-cols-3">
      {items.map(([label, cents]) => (
        <Card key={label}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold text-foreground">{formatCents(cents)}</p>
          </CardContent>
        </Card>
      ))}
      <p className="text-sm text-muted-foreground sm:col-span-3">
        {summary.recordCount} entries in {year ?? "this year"}. Recorded income minus expenses only; not taxes owed or a determination of deductibility.
      </p>
    </section>
  );
}
