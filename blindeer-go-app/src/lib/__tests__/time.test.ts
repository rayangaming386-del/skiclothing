import { describe, expect, it } from 'vitest';
import { dayRangeUtc, formatTime, isoDateOf, localToUtcIso, minutesOfDay } from '../time';

describe('bedrijfstijd Europe/Amsterdam', () => {
  it('zomertijd: 10:00 = 08:00 UTC', () => {
    expect(localToUtcIso('2026-10-19', '10:00')).toBe('2026-10-19T08:00:00.000Z');
  });
  it('wintertijd na 25-10-2026: 10:00 = 09:00 UTC', () => {
    expect(localToUtcIso('2026-10-26', '10:00')).toBe('2026-10-26T09:00:00.000Z');
  });
  it('weergave altijd in Nederlandse tijd, ongeacht apparaat-tijdzone', () => {
    expect(formatTime('2026-10-19T08:00:00Z')).toBe('10:00');
    expect(formatTime('2026-10-26T09:00:00Z')).toBe('10:00');
    expect(isoDateOf('2026-10-19T22:30:00Z')).toBe('2026-10-20');
    expect(minutesOfDay('2026-03-29T11:00:00Z')).toBe(13 * 60); // na overgang naar zomertijd
  });
  it('dag met 25 uur (wintertijd) heeft correcte grenzen', () => {
    expect(dayRangeUtc('2026-10-25')).toEqual({ from: '2026-10-24T22:00:00.000Z', to: '2026-10-25T23:00:00.000Z' });
  });
  it('werkt ook als het proces in een andere tijdzone draait', () => {
    // De test-runner wordt met TZ=America/New_York gestart (zie package.json).
    expect(localToUtcIso('2026-07-01', '21:00')).toBe('2026-07-01T19:00:00.000Z');
  });
});
