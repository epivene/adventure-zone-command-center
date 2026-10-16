import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@workspace/avz-crm/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@workspace/avz-crm/components/ui/alert-dialog";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Card, CardContent } from "@workspace/avz-crm/components/ui/card";
import { Checkbox } from "@workspace/avz-crm/components/ui/checkbox";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/avz-crm/components/ui/select";
import { Skeleton } from "@workspace/avz-crm/components/ui/skeleton";
import {
  FILING_STATUSES, centsToInput, describeError, formatCents, getEstimate, labelOf, parseMoneyToCents, saveEstimate,
  type Estimate, type EstimateResponse, type EstimateSettings, type FilingStatus,
} from "@/features/agent-tax/client";
import { MoneyField } from "./MoneyField";

type MoneyKey = Exclude<keyof EstimateSettings, "filingStatus" | "fullYearNdResident">;
const FIELDS: { key: MoneyKey; label: string; help: string; signed?: boolean; nullable?: boolean }[] = [
  { key: "additionalIncomeCents", label: "Expected additional income, rest of year", help: "Your expected remainder of the year. Not annualized automatically and does not include unpaid earnings automatically." },
  { key: "additionalExpensesCents", label: "Expected additional expenses, rest of year", help: "Your expected remainder of the year." },
  { key: "nonDeductibleExpensesCents", label: "Recorded expenses that should not reduce profit", help: "Cannot exceed recorded expenses. Other recorded expenses are treated as planning deductions; review their eligibility yourself." },
  { key: "wagesCents", label: "W-2 wages (box 1), household", help: "Annual. Joint filers include spouse." },
  { key: "ownSocialSecurityWagesCents", label: "Your own Social Security wages (box 3)", help: "Annual, yours only, not your spouse's." },
  { key: "medicareWagesCents", label: "Medicare wages (box 5), household", help: "Annual. Joint filers include spouse." },
  { key: "otherIncomeCents", label: "Other ordinary income", help: "Ordinary-rate income only; not capital gains or qualified dividends." },
  { key: "otherAdjustmentsCents", label: "Other above-the-line deductions", help: "Not already recorded as expenses." },
  { key: "deductionOverrideCents", label: "Deduction override (optional)", help: "Leave blank to use the year's base standard deduction. Enter a full amount for itemized, dependent, age, blind or other applicable deductions.", nullable: true },
  { key: "qbiDeductionCents", label: "Qualified business income deduction", help: "Enter only if you have confirmed it. The app does not determine eligibility; leaving 0 can overestimate income tax.", },
  { key: "ndAdjustmentCents", label: "North Dakota adjustment (can be negative)", help: "Signed addition or subtraction to federal taxable income.", signed: true },
  { key: "federalCreditsCents", label: "Federal nonrefundable credits", help: "Manually entered; default 0." },
  { key: "ndCreditsCents", label: "North Dakota nonrefundable credits", help: "Manually entered; default 0." },
  { key: "federalWithholdingCents", label: "Federal withholding, full year", help: "Not inferred from receipts. Does not reduce business profit." },
  { key: "ndWithholdingCents", label: "North Dakota withholding, full year", help: "Not inferred from receipts." },
  { key: "federalPaymentsCents", label: "Federal estimated payments already made", help: "Payments made, not forecasts. Do not also enter as expenses." },
  { key: "ndPaymentsCents", label: "North Dakota estimated payments already made", help: "Payments made, not forecasts." },
];

function toForm(s: EstimateSettings | null) {
  const m: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = s ? s[f.key] : f.nullable ? null : 0;
    m[f.key] = v === null ? "" : centsToInput(v);
  }
  return { filing: (s?.filingStatus ?? "") as FilingStatus | "", nd: s?.fullYearNdResident === true, money: m };
}

function Row({ label, cents, strong }: { label: string; cents: number; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <span className={strong ? "font-bold text-foreground" : "text-sm text-muted-foreground"}>{label}</span>
      <span className={strong ? "font-bold text-foreground" : "text-sm text-foreground"}>{formatCents(cents)}</span>
    </div>
  );
}

function Breakdown({ e }: { e: Estimate }) {
  const bal = (c: number) => (c < 0 ? `${formatCents(-c)} projected overpayment` : formatCents(c));
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card><CardContent className="p-4">
        <h3 className="mb-1 font-bold text-foreground">Self-employment</h3>
        <Row label="Projected profit" cents={e.projectedProfitCents} />
        <Row label="Net self-employment earnings" cents={e.netSelfEmploymentEarningsCents} />
        <Row label="Self-employment tax" cents={e.selfEmploymentTaxCents} />
        <Row label="Half of self-employment tax deduction" cents={e.halfSelfEmploymentDeductionCents} />
        <Row label="Additional Medicare tax" cents={e.additionalMedicareTaxCents} />
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <h3 className="mb-1 font-bold text-foreground">Federal income tax</h3>
        <Row label="Adjusted gross income" cents={e.adjustedGrossIncomeCents} />
        <Row label="Deduction" cents={e.deductionCents} />
        <Row label="Qualified business income deduction" cents={e.qbiDeductionCents} />
        <Row label="Federal taxable income" cents={e.federalTaxableIncomeCents} />
        <Row label="Federal income tax" cents={e.federalIncomeTaxCents} />
        <Row label="Federal liability (income tax, self-employment, Medicare)" cents={e.federalLiabilityCents} />
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <h3 className="mb-1 font-bold text-foreground">North Dakota income tax</h3>
        <Row label="North Dakota taxable income" cents={e.ndTaxableIncomeCents} />
        <Row label="North Dakota income tax" cents={e.ndIncomeTaxCents} />
      </CardContent></Card>
      <Card><CardContent className="p-4">
        <h3 className="mb-1 font-bold text-foreground">After withholding and payments</h3>
        <Row label="Total projected liability" cents={e.totalLiabilityCents} />
        <div className="flex justify-between gap-3 py-2 text-sm"><span className="text-muted-foreground">Federal balance</span><span className="text-foreground">{bal(e.federalBalanceCents)}</span></div>
        <div className="flex justify-between gap-3 py-2 text-sm"><span className="text-muted-foreground">North Dakota balance</span><span className="text-foreground">{bal(e.ndBalanceCents)}</span></div>
        <Row label="Remaining to set aside" cents={e.remainingToSetAsideCents} strong />
        <p className="pt-1 text-sm text-muted-foreground">Sums the positive IRS and North Dakota balances separately; an overpayment to one cannot pay the other.</p>
      </CardContent></Card>
    </div>
  );
}

export function EstimateTab({ refreshKey }: { refreshKey: number }) {
  const [year, setYear] = useState(2026);
  const [data, setData] = useState<EstimateResponse | null>(null);
  const [form, setForm] = useState(() => toForm(null));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tick, setTick] = useState(0);
  const [pendingYear, setPendingYear] = useState<number | null>(null);
  const reqId = useRef(0);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const firstRefresh = useRef(true);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  const dirty = useMemo(
    () => !!data && JSON.stringify(form) !== JSON.stringify(toForm(data.settings)),
    [form, data],
  );
  dirtyRef.current = dirty;
  busyRef.current = busy;

  // Explicit loads (year change, retry, reload latest) replace the response and form.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true); setSaved(false); setSaveError(null); setErrors({});
    getEstimate(year)
      .then((r) => { if (id === reqId.current) { setData(r); setForm(toForm(r.settings)); setLoadError(null); } })
      .catch((e) => { if (id === reqId.current) setLoadError(describeError(e)); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  }, [year, tick]);

  // Ledger changes elsewhere: refresh quietly, but never over unsaved edits or an in-flight save.
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    if (dirtyRef.current || busyRef.current) return;
    const id = ++reqId.current;
    getEstimate(year)
      .then((r) => { if (id === reqId.current && !dirtyRef.current && !busyRef.current) { setData(r); setForm(toForm(r.settings)); } })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  function changeYear(next: number) {
    if (next === year) return;
    if (dirty) { setPendingYear(next); return; }
    applyYear(next);
  }
  function applyYear(next: number) {
    setPendingYear(null); setData(null); setLoadError(null); setForm(toForm(null)); setYear(next);
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy || !data) return;
    const e: Record<string, string> = {};
    if (!form.filing) e.filing = "Choose your filing status.";
    if (!form.nd) e.nd = "Confirm full-year North Dakota residence to use this estimate.";
    const parsed: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const raw = form.money[f.key];
      if (raw.trim() === "" && f.nullable) { parsed[f.key] = null; continue; }
      const v = parseMoneyToCents(raw, f.signed);
      if (v === null) e[f.key] = f.signed ? "Enter an amount with up to 2 decimals." : "Enter a non-negative amount with up to 2 decimals.";
      parsed[f.key] = v;
    }
    setErrors(e);
    if (Object.keys(e).length) return;
    const settings = { filingStatus: form.filing as FilingStatus, fullYearNdResident: true, ...parsed } as EstimateSettings;
    setBusy(true); setSaveError(null); setSaved(false);
    try {
      const r = await saveEstimate(year, data.revision, settings);
      setData(r); setForm(toForm(r.settings)); setSaved(true);
    } catch (err) { setSaveError(describeError(err)); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        An annual planning estimate, not a tax return or payment schedule. Save your assumptions explicitly; nothing is guessed for you.
      </p>
      <div className="grid max-w-xs gap-2">
        <Label>Tax year</Label>
        <Select value={String(year)} disabled={busy || loading} onValueChange={(v) => changeYear(Number(v))}>
          <SelectTrigger aria-label="Estimate tax year"><SelectValue /></SelectTrigger>
          <SelectContent>{(data?.supportedYears ?? [2025, 2026]).map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      {loading && !data ? <Skeleton className="h-48 w-full" /> : loadError ? (
        <Alert variant="destructive" role="alert"><AlertTitle>Could not load estimate</AlertTitle>
          <AlertDescription className="grid gap-2"><span>{loadError}</span><span><Button size="sm" variant="outline" onClick={reload}>Retry</Button></span></AlertDescription></Alert>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            {([["Recorded income", data.recorded.incomeCents], ["Recorded expenses", data.recorded.expenseCents], ["Recorded profit", data.recorded.profitCents]] as const).map(([l, c]) => (
              <Card key={l}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{l}</p><p className="text-2xl font-bold text-foreground">{formatCents(c)}</p></CardContent></Card>
            ))}
          </div>

          {data.estimate && dirty ? (
            <Alert><AlertTitle>Showing last saved assumptions</AlertTitle><AlertDescription>You have unsaved changes. The results below are not live; save your assumptions to recalculate.</AlertDescription></Alert>
          ) : null}
          {data.estimate ? <Breakdown e={data.estimate} /> : (
            <Alert><AlertTitle>No estimate yet</AlertTitle><AlertDescription>Choose a filing status, confirm residence, and save your assumptions to see an estimate.</AlertDescription></Alert>
          )}

          <form className="grid gap-4 rounded-md border border-border p-4" onSubmit={submit} noValidate>
            <h3 className="font-bold text-foreground">Assumptions for {year}</h3>
            <p className="text-sm text-muted-foreground">Do not enter Social Security or account numbers. Amounts are in USD.</p>
            {saveError ? <Alert variant="destructive" role="alert"><AlertTitle>Could not save</AlertTitle><AlertDescription className="grid gap-2"><span>{saveError}</span><span><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setSaveError(null); reload(); }}>Discard my edits and reload latest</Button></span></AlertDescription></Alert> : null}
            {saved ? <Alert role="status"><AlertDescription>Assumptions saved.</AlertDescription></Alert> : null}
            <fieldset disabled={busy || loading} className="grid gap-4">
            <div className="grid gap-2 sm:max-w-sm">
              <Label>Filing status</Label>
              <Select disabled={busy || loading} value={form.filing} onValueChange={(v) => setForm((p) => ({ ...p, filing: v as FilingStatus }))}>
                <SelectTrigger aria-label="Filing status"><SelectValue placeholder="Choose filing status" /></SelectTrigger>
                <SelectContent>{FILING_STATUSES.map((s) => <SelectItem key={s} value={s}>{labelOf(s)}</SelectItem>)}</SelectContent>
              </Select>
              {errors.filing ? <p className="text-sm text-destructive">{errors.filing}</p> : null}
            </div>
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Checkbox id="est-nd" disabled={busy || loading} checked={form.nd} onCheckedChange={(c) => setForm((p) => ({ ...p, nd: c === true }))} />
                <Label htmlFor="est-nd">I was a North Dakota resident for the full year</Label>
              </div>
              {errors.nd ? <p className="text-sm text-destructive">{errors.nd}</p> : null}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {FIELDS.map((f) => (
                <MoneyField key={f.key} disabled={busy || loading} id={`est-${f.key}`} label={f.label} help={f.help} error={errors[f.key]}
                  value={form.money[f.key]} onChange={(v) => setForm((p) => ({ ...p, money: { ...p.money, [f.key]: v } }))} />
              ))}
            </div>
            </fieldset>
            <div><Button type="submit" disabled={busy || loading || !!loadError || !data}>{busy ? "Saving" : "Save assumptions"}</Button></div>
          </form>

          {data.warnings.length ? (
            <Alert><AlertTitle>Warnings and limits</AlertTitle>
              <AlertDescription><ul className="grid list-disc gap-1 pl-4">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul></AlertDescription></Alert>
          ) : null}
          <section className="grid gap-1 text-sm">
            <h3 className="font-bold text-foreground">Sources</h3>
            <ul className="grid gap-1">
              {data.sources.map((s) => <li key={s.url}><a className="break-all text-primary underline" href={s.url} target="_blank" rel="noopener noreferrer">{s.title}</a></li>)}
            </ul>
          </section>
        </>
      ) : null}
      <AlertDialog open={pendingYear !== null} onOpenChange={(o) => { if (!o) setPendingYear(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved assumptions?</AlertDialogTitle>
            <AlertDialogDescription>Switching to {pendingYear} will discard your unsaved changes for {year}.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingYear !== null && applyYear(pendingYear)}>Discard and switch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
