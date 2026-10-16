import { Input } from "@workspace/avz-crm/components/ui/input";
import { Label } from "@workspace/avz-crm/components/ui/label";

interface Props { id: string; label: string; value: string; onChange: (v: string) => void; error?: string; help?: string; disabled?: boolean }

export function MoneyField({ id, label, value, onChange, error, help, disabled }: Props) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} inputMode="decimal" placeholder="0.00" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} />
      {help ? <p className="text-sm text-muted-foreground">{help}</p> : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
