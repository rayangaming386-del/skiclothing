// Tijdhulpmiddelen. Alles wordt weergegeven in de bedrijfstijdzone (standaard Europe/Amsterdam),
// ongeacht de tijdzone van de telefoon. Zomer-/wintertijd wordt door Luxon/IANA afgehandeld.
import { DateTime, Settings } from 'luxon';

export const DEFAULT_TZ = 'Europe/Amsterdam';
Settings.defaultLocale = 'nl';

let businessZone = DEFAULT_TZ;
export function setBusinessZone(tz: string | null | undefined) {
  businessZone = tz || DEFAULT_TZ;
}
export function getBusinessZone() {
  return businessZone;
}

export function inZone(iso: string | Date, zone = businessZone): DateTime {
  const dt = typeof iso === 'string' ? DateTime.fromISO(iso, { setZone: false }) : DateTime.fromJSDate(iso);
  return dt.setZone(zone);
}

export function nowInZone(zone = businessZone): DateTime {
  return DateTime.now().setZone(zone);
}

/** Lokale bedrijfsdatum (yyyy-MM-dd) + tijd (HH:mm) → ISO-string in UTC. */
export function localToUtcIso(date: string, time: string, zone = businessZone): string {
  const dt = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!dt.isValid) throw new Error(`Ongeldige datum/tijd: ${date} ${time}`);
  return dt.toUTC().toISO()!;
}

/** Begin en einde (UTC) van een bedrijfsdag, voor queries. Houdt rekening met 23/25-uursdagen. */
export function dayRangeUtc(date: string, zone = businessZone): { from: string; to: string } {
  const start = DateTime.fromISO(date, { zone }).startOf('day');
  return { from: start.toUTC().toISO()!, to: start.plus({ days: 1 }).toUTC().toISO()! };
}

export function todayIsoDate(zone = businessZone): string {
  return nowInZone(zone).toISODate()!;
}

export function addDays(date: string, days: number, zone = businessZone): string {
  return DateTime.fromISO(date, { zone }).plus({ days }).toISODate()!;
}

export function startOfWeek(date: string, zone = businessZone): string {
  return DateTime.fromISO(date, { zone }).startOf('week').toISODate()!; // ISO-week: maandag
}

export function formatTime(iso: string, zone = businessZone): string {
  return inZone(iso, zone).toFormat('HH:mm');
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function formatDateLong(date: string, zone = businessZone): string {
  return capitalize(DateTime.fromISO(date, { zone }).setLocale('nl').toFormat('cccc d LLLL yyyy'));
}

export function formatDateShort(date: string, zone = businessZone): string {
  return DateTime.fromISO(date, { zone }).setLocale('nl').toFormat('ccc d LLL');
}

export function formatDateTime(iso: string, zone = businessZone): string {
  return inZone(iso, zone).setLocale('nl').toFormat("ccc d LLL yyyy 'om' HH:mm");
}

export function isoDateOf(iso: string, zone = businessZone): string {
  return inZone(iso, zone).toISODate()!;
}

/** Minuten sinds middernacht (bedrijfstijd) — voor plaatsing in de dagweergave. */
export function minutesOfDay(iso: string, zone = businessZone): number {
  const d = inZone(iso, zone);
  return d.hour * 60 + d.minute;
}

export function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** ISO-weekdag (1 = maandag … 7 = zondag) van een bedrijfsdatum. */
export function isoWeekday(date: string, zone = businessZone): number {
  return DateTime.fromISO(date, { zone }).weekday;
}

export const WEEKDAYS = ['maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag', 'zondag'];
