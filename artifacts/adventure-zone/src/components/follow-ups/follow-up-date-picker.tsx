import { useEffect, useState } from "react";
import { Calendar } from "@/components/ui/calendar";
import { BUSINESS_TIME_ZONE, businessDateKey, parseBusinessDate } from "@/lib/business-date";

function display(value: string) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return parts ? `${parts[2]}/${parts[3]}/${parts[1]}` : value;
}
export function FollowUpDatePicker({ value, onChange }: { value: string; onChange(value: string): void }) {
  const [text, setText] = useState(display(value));
  const [month, setMonth] = useState<Date>();
  useEffect(() => setText(display(value)), [value]);
  const selected = parseBusinessDate(value);
  const key = selected ? businessDateKey(selected) : null;
  // DayPicker uses local calendar components; timestamps are converted only at save.
  const calendarDate = key ? new Date(`${key}T12:00:00`) : undefined;
  function choose(key: string) { onChange(key); setText(display(key)); setMonth(new Date(`${key}T12:00:00`)); }
  function shortcut(days: number) {
    const date = new Date(`${businessDateKey(new Date())}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    choose(date.toISOString().slice(0, 10));
  }
  return <div className="grid gap-2">
    <label className="grid gap-1 text-sm font-semibold">Due date
      <input className="rounded-md border bg-background p-2 text-base" placeholder="MM/DD/YYYY" inputMode="numeric" value={text} onChange={e => {
        const next=e.target.value; setText(next);
        const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(next);
        const key=match ? `${match[3]}-${match[1]}-${match[2]}` : next;
        onChange(key);
      }} />
    </label>
    {text && !selected ? <p role="alert" className="text-sm text-rose-700">Enter a valid date as MM/DD/YYYY.</p> : null}
    <div className="flex flex-wrap gap-2">{[["Today",0],["Tomorrow",1],["Next week",7]].map(([label, days]) => <button key={label} className="button-secondary" type="button" onClick={() => shortcut(Number(days))}>{label}</button>)}</div>
    <Calendar mode="single" captionLayout="dropdown" selected={calendarDate} month={month ?? calendarDate} onMonthChange={setMonth} startMonth={new Date(2000,0)} endMonth={new Date(2100,11)} onSelect={date => { if(date) choose(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`); }} />
    <p className="text-sm text-muted-foreground" aria-live="polite">{selected ? new Intl.DateTimeFormat("en-US",{timeZone:BUSINESS_TIME_ZONE,dateStyle:"full"}).format(selected) : "Choose a due date"}</p>
  </div>;
}
