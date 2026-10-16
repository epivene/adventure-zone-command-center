import { useCallback, useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/avz-crm/components/ui/empty";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/avz-crm/components/ui/tabs";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import { describeError, exportCsv, listRecords, type RecordsResponse, type TaxRecord } from "@/features/agent-tax/client";
import { RecordFormDialog } from "@/components/agent-tax/RecordFormDialog";
import { DeleteRecordDialog } from "@/components/agent-tax/ConfirmDialogs";
import { RecordList } from "@/components/agent-tax/RecordList";
import { PayTab } from "@/components/agent-tax/PayTab";
import { EstimateTab } from "@/components/agent-tax/EstimateTab";
import { SummaryCards } from "@/components/agent-tax/SummaryCards";

const LIMIT = 25;

export default function TaxReceiptsPage() {
  const [year, setYear] = useState<number | null>(new Date().getFullYear());
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<RecordsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaxRecord | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<TaxRecord | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const [ledgerKey, setLedgerKey] = useState(0);
  const ledgerChanged = useCallback(() => { setTick((t) => t + 1); setLedgerKey((k) => k + 1); }, []);

  useEffect(() => {
    const t = window.setTimeout(() => { setQ(qInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    listRecords({ year, q, page, limit: LIMIT })
      .then((r) => { if (active) { setData(r); setError(null); } })
      .catch((e) => { if (active) setError(describeError(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [year, q, page, tick]);

  const years = Array.from(new Set([...(data?.years ?? []), new Date().getFullYear()])).sort((a, b) => b - a);
  const pages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;
  const openForm = (r: TaxRecord | null) => { setEditing(r); setFormOpen(true); };

  async function doExport() {
    if (!year) return;
    setExporting(true); setExportError(null);
    try { await exportCsv(year); } catch (e) { setExportError(describeError(e)); } finally { setExporting(false); }
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-5">
      <header>
        <p className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Admin, owner only</p>
        <h1 className="mt-1 text-3xl font-bold text-foreground">Tax & Receipts</h1>
        <p className="mt-2 text-muted-foreground">
          A private personal booking-agent finance workspace for self-employed / 1099 booking-agent work: documents, income and expenses kept for tax preparation. Only you can see this in Admin. Do not store Social Security or account numbers here. Totals are recorded income minus expenses, not taxes owed or a determination of deductibility. Save tax payment receipts as documents.
        </p>
      </header>

      <Tabs defaultValue="records" className="grid gap-4">
        <TabsList className="h-auto w-full flex-wrap justify-start sm:w-fit">
          <TabsTrigger value="records">Records</TabsTrigger>
          <TabsTrigger value="pay">Pay owed to me</TabsTrigger>
          <TabsTrigger value="estimate">Tax estimate</TabsTrigger>
        </TabsList>
        <TabsContent value="records" className="grid gap-5">
      {data && !data.storageAvailable ? (
        <Alert><AlertTitle>File storage unavailable</AlertTitle><AlertDescription>You can keep entries, but attachments cannot be uploaded or opened right now.</AlertDescription></Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_auto_auto]">
        <Select value={year ? String(year) : "all"} onValueChange={(v) => { setYear(v === "all" ? null : Number(v)); setPage(1); }}>
          <SelectTrigger aria-label="Tax year"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input aria-label="Search entries" placeholder="Search title, counterparty, notes" value={qInput} onChange={(e) => setQInput(e.target.value)} />
        <Button variant="outline" disabled={!year || exporting} onClick={doExport}>{exporting ? "Exporting" : "Export CSV"}</Button>
        <Button onClick={() => openForm(null)}>New entry</Button>
      </div>
      {exportError ? <p className="text-sm text-destructive" role="alert">{exportError}</p> : null}

      {data ? <SummaryCards summary={data.summary} year={year} /> : null}

      {loading && !data ? (
        <div className="grid gap-3"><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-24 w-full" /></div>
      ) : error ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Could not load entries</AlertTitle>
          <AlertDescription className="grid gap-2"><span>{error}</span><span><Button size="sm" variant="outline" onClick={reload}>Retry</Button></span></AlertDescription>
        </Alert>
      ) : data && data.records.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{q ? "No matching entries" : "No entries yet"}</EmptyTitle>
            <EmptyDescription>{q ? "Try a different search or tax year." : "Add a receipt, income or expense to start your record."}</EmptyDescription>
          </EmptyHeader>
          {!q ? <Button onClick={() => openForm(null)}>New entry</Button> : null}
        </Empty>
      ) : data ? (
        <div className={loading ? "opacity-60" : undefined}>
          <RecordList records={data.records} onEdit={openForm} onDelete={setDeleting} />
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button variant="outline" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>Previous</Button>
            <span className="text-sm text-muted-foreground">Page {page} of {pages} ({data.total} entries)</span>
            <Button variant="outline" disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)}>Next</Button>
          </div>
        </div>
      ) : null}

        </TabsContent>
        <TabsContent value="pay"><PayTab onLedgerChanged={ledgerChanged} /></TabsContent>
        <TabsContent value="estimate" forceMount className="data-[state=inactive]:hidden"><EstimateTab refreshKey={ledgerKey} /></TabsContent>
      </Tabs>

      <RecordFormDialog open={formOpen} record={editing} defaultYear={year ?? new Date().getFullYear()} onClose={() => setFormOpen(false)} onSaved={ledgerChanged} />
      <DeleteRecordDialog record={deleting} onCancel={() => setDeleting(null)} onDeleted={() => { setDeleting(null); ledgerChanged(); }} />
    </div>
  );
}
