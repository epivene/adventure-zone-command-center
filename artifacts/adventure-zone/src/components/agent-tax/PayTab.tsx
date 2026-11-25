import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@workspace/avz-crm/components/ui/alert-dialog";
import { Badge } from "@workspace/avz-crm/components/ui/badge";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent } from "@workspace/avz-crm/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/avz-crm/components/ui/empty";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { deletePay, describeError, exportPayCsv, formatCents, listPay, unlinkRecordedIncome, type PayItem, type PayResponse } from "@/features/agent-tax/client";
import { PayItemDialog } from "./PayItemDialog";
import { LinkIncomeDialog } from "./LinkIncomeDialog";
import { PaymentDialog } from "./PaymentDialog";

const LIMIT = 25;

export function PayTab({ onLedgerChanged }: { onLedgerChanged: () => void }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [dialog, setDialog] = useState<{ item: PayItem | null; mode: "weekly" | "manual" } | null>(null);
  const [linking,setLinking]=useState<PayItem|null>(null);
  const [unlinking,setUnlinking]=useState<string|null>(null);
  const [linkError,setLinkError]=useState<string|null>(null);
  const [paying, setPaying] = useState<PayItem | null>(null);
  const [deleting, setDeleting] = useState<PayItem | null>(null);
  const [delError, setDelError] = useState<string | null>(null);
  const [delBusy, setDelBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listPay(page, LIMIT)
      .then((r) => { if (active) { setData(r); setError(null); } })
      .catch((e) => { if (active) setError(describeError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, tick]);

  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const s = data?.summary;
  const cards = s ? ([["Total earned", s.earnedCents], ["Paid so far", s.paidCents], ["Still owed to me", s.remainingCents], ["Overdue", s.overdueCents]] as const) : [];

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Track pay owed to you. Your default is $600.00 per week, added only when you add a week. Unpaid pay is not received income; recording a payment adds one income entry to Records. If you already entered the income in Records, use Apply recorded income on the week it paid. You can split a payment across weeks without recording income twice. Totals cover all dates.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setDialog({ item: null, mode: "weekly" })}>Add earned week</Button>
        <Button variant="outline" onClick={() => setDialog({ item: null, mode: "manual" })}>Add manual entry</Button>
        <Button variant="outline" onClick={() => { setExportError(null); exportPayCsv().catch((e) => setExportError(describeError(e))); }}>Export CSV</Button>
      </div>
      {linkError ? <p className="text-sm text-destructive" role="alert">{linkError}</p> : null}
      {exportError ? <p className="text-sm text-destructive" role="alert">{exportError}</p> : null}
      {s ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {cards.map(([label, cents]) => (
            <Card key={label}><CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-bold text-foreground">{formatCents(cents)}</p>
            </CardContent></Card>
          ))}
        </div>
      ) : null}

      {loading && !data ? <div className="grid gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      : error ? (
        <Alert variant="destructive" role="alert"><AlertTitle>Could not load pay</AlertTitle>
          <AlertDescription className="grid gap-2"><span>{error}</span><span><Button size="sm" variant="outline" onClick={reload}>Retry</Button></span></AlertDescription></Alert>
      ) : data && data.items.length === 0 ? (
        <Empty><EmptyHeader><EmptyTitle>No pay entries yet</EmptyTitle><EmptyDescription>Add an earned week or a manual entry to track what you are owed.</EmptyDescription></EmptyHeader></Empty>
      ) : data ? (
        <div className={loading ? "opacity-60" : undefined}>
          <ul className="grid gap-3">
            {data.items.map((it) => (
              <li key={it.id}>
                <Card><CardContent className="grid gap-3 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="break-words font-bold text-foreground">{it.title}</h2>
                      <p className="text-sm text-muted-foreground">Earned {it.earnedDate}{it.dueDate ? ` · Due ${it.dueDate}` : ""}</p>
                    </div>
                    <p className="text-lg font-bold text-foreground">{formatCents(it.amountCents)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">{it.kind === "weekly" ? "Weekly" : "Manual"}</Badge>
                    <Badge variant="outline">Paid {formatCents(it.paidCents)}</Badge>
                    <Badge variant={it.remainingCents > 0 ? "default" : "outline"}>{it.remainingCents > 0 ? `Owed ${formatCents(it.remainingCents)}` : "Paid in full"}</Badge>
                  </div>
                  {it.notes ? <p className="whitespace-pre-wrap text-sm text-muted-foreground">{it.notes}</p> : null}
                  {it.payments.length ? (
                    <ul className="grid gap-1 text-sm text-muted-foreground">
                      {it.payments.map((p) => <li key={p.id}>{formatCents(p.amountCents)} received {p.recordDate ?? ""} ({p.paymentMethod}). {p.linkedExisting ? <>
                        Applied from “{p.title}”. <Button size="sm" variant="outline" disabled={!!unlinking} onClick={async()=>{
                          setUnlinking(p.id);setLinkError(null);
                          try{await unlinkRecordedIncome(it,p);reload();onLedgerChanged();}
                          catch(e){setLinkError(describeError(e));reload();}finally{setUnlinking(null);}
                        }}>Unlink from week</Button>
                      </> : "Edit or remove it in Records."}</li>)}
                    </ul>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" disabled={it.remainingCents <= 0} onClick={() => setPaying(it)}>Record payment</Button>
                    <Button size="sm" variant="outline" disabled={it.remainingCents <= 0} onClick={() => setLinking(it)}>Apply recorded income</Button>
                    <Button size="sm" variant="outline" onClick={() => setDialog({ item: it, mode: it.kind })}>Edit</Button>
                    <Button size="sm" variant="outline" disabled={it.payments.length > 0} title={it.payments.length ? "Remove its payment income entries in Records first" : undefined} onClick={() => { setDelError(null); setDeleting(it); }}>Delete</Button>
                  </div>
                </CardContent></Card>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page} of {pages}</span>
            <Button variant="outline" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}

      <PayItemDialog open={!!dialog} item={dialog?.item ?? null} mode={dialog?.mode ?? "weekly"} onClose={() => setDialog(null)} onSaved={reload} />
      <LinkIncomeDialog item={linking} onClose={()=>setLinking(null)} onSaved={()=>{reload();onLedgerChanged();}} />
      <PaymentDialog item={paying} onClose={() => setPaying(null)} onSaved={() => { reload(); onLedgerChanged(); }} />
      <AlertDialog open={!!deleting} onOpenChange={(o) => { if (!o && !delBusy) setDeleting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pay entry?</AlertDialogTitle>
            <AlertDialogDescription>"{deleting?.title}" will be permanently deleted. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          {delError ? <Alert variant="destructive" role="alert"><AlertDescription>{delError}</AlertDescription></Alert> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={delBusy}>Cancel</AlertDialogCancel>
            <Button variant="destructive" disabled={delBusy} onClick={async () => {
              if (!deleting) return;
              setDelBusy(true); setDelError(null);
              try { await deletePay(deleting.id, deleting.revision); setDeleting(null); reload(); }
              catch (e) { setDelError(describeError(e)); } finally { setDelBusy(false); }
            }}>{delBusy ? "Working" : "Delete entry"}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
