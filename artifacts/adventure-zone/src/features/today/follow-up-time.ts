const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Denver",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export function mountainInput(value: string) {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(value)).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function mountainInstant(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid Mountain date and time.");
  const wall = Date.parse(`${value}:00Z`);
  // Mountain time uses UTC-6 or UTC-7. Comparing round trips rejects invalid
  // dates and the missing spring hour. The earlier instant wins in the fall.
  for (const hours of [6, 7]) {
    const candidate = new Date(wall + hours * 3600000).toISOString();
    if (mountainInput(candidate) === value) return candidate;
  }
  throw new Error("That Mountain time does not exist. Choose another time.");
}
