import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent } from "@workspace/avz-crm/components/ui/card";
import { useState } from "react";
import { describeError, downloadFile, formatCents, labelOf, viewFile, type TaxRecord } from "@/features/agent-tax/client";

interface Props { records: TaxRecord[]; onEdit: (r: TaxRecord) => void; onDelete: (r: TaxRecord) => void }

export function RecordList({ records, onEdit, onDelete }: Props) {
  const [fileError, setFileError] = useState<string | null>(null);
  async function run(fn: () => Promise<void>) {
    setFileError(null);
    try { await fn(); } catch (e) { setFileError(describeError(e)); }
  }
  return (
    <div className="grid gap-3">
      {fileError ? <p className="text-sm text-destructive" role="alert">{fileError}</p> : null}
      <ul className="grid gap-3">
        {records.map((r) => (
          <li key={r.id}>
            <Card>
              <CardContent className="grid gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="break-words font-bold text-foreground">{r.title}</h2>
                    <p className="text-sm text-muted-foreground">
                      {[r.recordDate ?? "No date", `Tax year ${r.taxYear}`, r.counterparty].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="text-lg font-bold text-foreground">{r.amountCents === null ? "No amount" : formatCents(r.amountCents)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant={r.entryType === "income" ? "default" : "secondary"}>{labelOf(r.entryType)}</Badge>
                  <Badge variant="outline">{labelOf(r.category)}</Badge>
                  <Badge variant="outline">{labelOf(r.paymentMethod)}</Badge>
                  {r.bookingLabel ? <Badge variant="outline">{r.bookingLabel}</Badge> : null}
                </div>
                {r.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{r.notes}</p> : null}
                <div className="flex flex-wrap items-center gap-2">
                  {r.fileName ? (
                    <>
                      <span className="break-all text-sm text-foreground">{r.fileName}</span>
                      <Button size="sm" variant="outline" onClick={() => run(() => viewFile(r))}>View</Button>
                      <Button size="sm" variant="outline" onClick={() => run(() => downloadFile(r))}>Download</Button>
                    </>
                  ) : <span className="text-sm text-muted-foreground">No file attached</span>}
                  <div className="ml-auto flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => onEdit(r)}>Edit</Button>
                    <Button size="sm" variant="outline" onClick={() => onDelete(r)}>Delete</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
