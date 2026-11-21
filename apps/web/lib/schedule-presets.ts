/** Quick picks for "schedule send", in the user's local time. */
export function schedulePresets(now = new Date()): { label: string; at: Date }[] {
  const at = (d: Date, h: number, m = 0) => {
    const x = new Date(d);
    x.setHours(h, m, 0, 0);
    return x;
  };
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const monday = new Date(now);
  monday.setDate(now.getDate() + ((8 - now.getDay()) % 7 || 7));
  const out = [
    { label: 'In 1 hour', at: new Date(now.getTime() + 3600_000) },
    { label: 'Tomorrow at 9:00', at: at(tomorrow, 9) },
    { label: 'Monday at 9:00', at: at(monday, 9) },
  ];
  const evening = at(now, 17);
  if (evening.getTime() - now.getTime() > 30 * 60_000)
    out.splice(1, 0, { label: 'Today at 17:00', at: evening });
  return out;
}
