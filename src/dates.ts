// Civil (calendar) dates, independent of any time zone. A date is a
// "YYYY-MM-DD" string; arithmetic goes through a day number (days since
// 1970-01-01) so it never touches local time.

export type ISODate = string;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseISODate(value: string | undefined | null): ISODate | null {
  if (!value) return null;
  const m = DATE_RE.exec(value);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1) return null;
  if (d > daysInMonth(y, mo)) return null;
  return value;
}

export function parts(date: ISODate): { y: number; m: number; d: number } {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return { y, m, d };
}

export function fromParts(y: number, m: number, d: number): ISODate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function dayNumber(date: ISODate): number {
  const { y, m, d } = parts(date);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromDayNumber(n: number): ISODate {
  const dt = new Date(n * 86_400_000);
  return fromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function addDays(date: ISODate, days: number): ISODate {
  return fromDayNumber(dayNumber(date) + days);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return dayNumber(b) - dayNumber(a);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayMon0(date: ISODate): number {
  return (dayNumber(date) + 3) % 7; // 1970-01-01 was a Thursday
}

export function startOfWeek(date: ISODate): ISODate {
  return addDays(date, -weekdayMon0(date));
}

export function startOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return fromParts(y, m, 1);
}

export function endOfMonth(date: ISODate): ISODate {
  const { y, m } = parts(date);
  return fromParts(y, m, daysInMonth(y, m));
}

export function addMonths(date: ISODate, months: number): ISODate {
  const { y, m, d } = parts(date);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function eachDay(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let n = dayNumber(from); n <= dayNumber(to); n++) out.push(fromDayNumber(n));
  return out;
}
