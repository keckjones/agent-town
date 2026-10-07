// Time-zone helpers. Everything is stored in UTC; days and schedules are computed in the configured zone,
// so daylight-saving changes are handled automatically.

function parts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  const o = Object.fromEntries(f.formatToParts(date).filter((p) => p.type !== 'literal').map((p) => [p.type, Number(p.value)]));
  return o; // {year, month, day, hour, minute, second}
}

/** "YYYY-MM-DD" for a moment in a zone. */
export function localDate(date = new Date(), tz = 'America/Chicago') {
  const p = parts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Minutes since local midnight. */
export function localMinutes(date = new Date(), tz = 'America/Chicago') {
  const p = parts(date, tz);
  return p.hour * 60 + p.minute;
}

/** UTC instant of local midnight at the start of the given "YYYY-MM-DD" in tz. */
export function zonedMidnight(ymd, tz = 'America/Chicago') {
  const [y, m, d] = ymd.split('-').map(Number);
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  // Two passes converge for every real-world offset, including DST transition days.
  for (let i = 0; i < 2; i++) {
    const p = parts(new Date(guess), tz);
    const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    guess -= asIfUtc - Date.UTC(y, m - 1, d, 0, 0, 0);
  }
  return new Date(guess);
}

export function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** [startUtcISO, endUtcISO) for a local calendar day. */
export function dayRange(ymd, tz = 'America/Chicago') {
  return [zonedMidnight(ymd, tz).toISOString(), zonedMidnight(addDays(ymd, 1), tz).toISOString()];
}

/** Next time the local clock reads HH:MM, as a Date. */
export function nextLocalTime(hhmm, tz = 'America/Chicago', from = new Date()) {
  const [h, m] = hhmm.split(':').map(Number);
  let day = localDate(from, tz);
  for (let i = 0; i < 3; i++) {
    const t = new Date(zonedMidnight(day, tz).getTime() + (h * 60 + m) * 60000);
    // Correct for a DST change between midnight and the target time.
    const drift = localMinutes(t, tz) - (h * 60 + m);
    const fixed = new Date(t.getTime() - drift * 60000);
    if (fixed > from) return fixed;
    day = addDays(day, 1);
  }
  return null;
}

export function fmtLocal(date, tz = 'America/Chicago') {
  return new Date(date).toLocaleString('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}
