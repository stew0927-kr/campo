// Times in survey files are ISO 8601 with the phone's own offset ("2026-11-14T10:00:00+09:00"), like the rest of the data.

const pad = (n: number, width = 2): string => String(Math.trunc(Math.abs(n))).padStart(width, '0');

/** `date` as local time with its UTC offset. `offsetMin` is minutes east of UTC (default: the device's). */
export function isoLocal(date: Date, offsetMin: number = -date.getTimezoneOffset()): string {
  const local = new Date(date.getTime() + offsetMin * 60_000);
  const day = `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;
  const offset = `${offsetMin < 0 ? '-' : '+'}${pad(offsetMin / 60)}:${pad(offsetMin % 60)}`;
  return `${day}T${time}${offset}`;
}

/** "20261114" from "2026-11-14T…". */
export function dayOf(iso: string): string {
  return iso.slice(0, 10).replaceAll('-', '');
}
