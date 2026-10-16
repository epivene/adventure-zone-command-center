import { useEffect, useState } from "react";
import { Button } from "@workspace/avz-crm/components/ui/button";
import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";
import { describeError, searchBookings } from "@/features/agent-tax/client";

interface Props { value: string | null; label: string | null; onChange: (id: string | null, label: string | null) => void }

export function BookingPicker({ value, label, onChange }: Props) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return; }
    let active = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchBookings(q.trim())
        .then((r) => { if (active) { setResults(r.bookings); setError(null); } })
        .catch((e) => { if (active) setError(describeError(e)); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(t); };
  }, [q]);

  return (
    <div className="grid gap-2">
      <Label htmlFor="tax-booking">Linked booking (optional)</Label>
      {value ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-foreground">{label ?? value}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onChange(null, null)}>Unlink</Button>
        </div>
      ) : null}
      <Input id="tax-booking" placeholder="Search by event name" value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {loading ? <p className="text-sm text-muted-foreground">Searching</p> : null}
      {results.length > 0 ? (
        <ul className="grid gap-1 rounded-md border border-border p-1">
          {results.map((b) => (
            <li key={b.id}>
              <Button type="button" variant="ghost" className="h-auto w-full justify-start whitespace-normal text-left" onClick={() => { onChange(b.id, b.label); setQ(""); setResults([]); }}>{b.label}</Button>
            </li>
          ))}
        </ul>
      ) : q.trim().length >= 2 && !loading && !error ? <p className="text-sm text-muted-foreground">No matching bookings.</p> : null}
    </div>
  );
}
