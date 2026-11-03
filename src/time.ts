export const TZ = 'Europe/Vilnius';

function offsetMs(date: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Local calendar date in Vilnius, YYYY-MM-DD. */
export function localDate(date: Date, tz = TZ): string {
  return new Date(date.getTime() + offsetMs(date, tz)).toISOString().slice(0, 10);
}

/** Start of the local day in Vilnius as an instant. */
export function dayStart(date: Date, tz = TZ): Date {
  const local = new Date(date.getTime() + offsetMs(date, tz));
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnight - offsetMs(new Date(midnight), tz));
}
