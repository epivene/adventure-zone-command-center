import { useEffect, useState } from "react";
import {
  Alert,
  AlertDescription,
} from "@workspace/avz-crm/components/ui/alert";
import { Button } from "@workspace/avz-crm/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/avz-crm/components/ui/dialog";
import { Label } from "@workspace/avz-crm/components/ui/label";
import {
  centsToInput,
  describeError,
  formatCents,
  linkRecordedIncome,
  listAvailableIncome,
  parseMoneyToCents,
  type AvailableIncome,
  type PayItem,
} from "@/features/agent-tax/client";
import { MoneyField } from "./MoneyField";

export function LinkIncomeDialog({
  item,
  onClose,
  onSaved,
}: {
  item: PayItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<AvailableIncome[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setPage(1);
    setSelected("");
    setAmount("");
    setError(null);
  }, [item]);
  useEffect(() => {
    if (!item) return;
    let active = true;
    setLoading(true);
    setRecords([]);
    setSelected("");
    setAmount("");
    setError(null);
    listAvailableIncome(page)
      .then((r) => {
        if (active) {
          setRecords(r.records);
          setMore(r.hasMore);
        }
      })
      .catch((e) => {
        if (active) setError(describeError(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [item, page]);
  const record = records.find((r) => r.id === selected);
  const cents = parseMoneyToCents(amount);
  const valid =
    !!item &&
    !!record &&
    cents !== null &&
    cents > 0 &&
    cents <= Math.min(record.availableCents, item.remainingCents);
  return (
    <Dialog
      open={!!item}
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Apply recorded income</DialogTitle>
          <DialogDescription>
            Choose a payment already entered in Records and the amount it paid
            toward {item?.title} (earned {item?.earnedDate}). Your income total
            and receipt stay unchanged.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!valid || !item || !record || cents === null || busy) return;
            setBusy(true);
            setError(null);
            try {
              await linkRecordedIncome(item.id, record, cents, item.revision);
              onSaved();
              onClose();
            } catch (e) {
              setError(describeError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>
                {error} Close and reopen to load current balances if needed.
              </AlertDescription>
            </Alert>
          ) : null}
          {loading ? (
            <p role="status">Loading recorded income…</p>
          ) : (
            <>
              <div className="grid gap-2">
                <Label htmlFor="recorded-income">
                  Income already received (all years)
                </Label>
                <select
                  id="recorded-income"
                  className="w-full min-w-0 rounded-md border bg-background p-2 text-sm"
                  value={selected}
                  disabled={busy}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    const r = records.find((r) => r.id === e.target.value);
                    setAmount(
                      r && item
                        ? centsToInput(
                            Math.min(r.availableCents, item.remainingCents),
                          )
                        : "",
                    );
                  }}
                >
                  <option value="">Choose recorded income</option>
                  {records.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.recordDate} · {r.title} ·{" "}
                      {r.counterparty || "No payer"} ·{" "}
                      {formatCents(r.availableCents)} unapplied
                    </option>
                  ))}
                </select>
                {!records.length ? (
                  <p className="text-sm text-muted-foreground">
                    No unapplied income on this page. Only income with an amount
                    still available is listed.
                  </p>
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={page === 1 || busy}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous income
                </Button>
                <span className="text-sm">Page {page}</span>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!more || busy}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next income
                </Button>
              </div>
            </>
          )}
          {record ? (
            <>
              <p className="text-sm">
                Received {formatCents(record.amountCents)} on{" "}
                {record.recordDate}; {formatCents(record.availableCents)} is
                available to apply. This week has{" "}
                {formatCents(item?.remainingCents ?? 0)} still owed.
              </p>
              <MoneyField
                id="link-income-amount"
                label="Amount to apply to this week (USD)"
                value={amount}
                onChange={setAmount}
                disabled={busy}
                help="Apply part here, then apply the remainder to another earned week."
                error={
                  !valid
                    ? "Enter an amount above zero within both available balances."
                    : undefined
                }
              />
              {valid && item && cents !== null ? (
                <p role="status">
                  Apply {formatCents(cents)} to this week. Still owed on this
                  week afterward: {formatCents(item.remainingCents - cents)}. No
                  new income will be recorded.
                </p>
              ) : null}
            </>
          ) : null}
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || busy || loading}>
              {busy ? "Applying…" : "Apply to earned week"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
