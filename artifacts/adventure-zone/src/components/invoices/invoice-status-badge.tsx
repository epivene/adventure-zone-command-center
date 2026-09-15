import { Badge } from "@workspace/avz-crm/components/ui/badge";
import type { InvoiceEffectiveStatus } from "@/features/invoices/invoice-types";

const labels: Record<InvoiceEffectiveStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  deposit_due: "Deposit due",
  deposit_paid: "Deposit paid",
  paid: "Paid",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

export function InvoiceStatusBadge({ status }: { status: InvoiceEffectiveStatus }) {
  return <Badge variant={status === "overdue" ? "destructive" : status === "paid" ? "secondary" : "outline"}>{labels[status]}</Badge>;
}
