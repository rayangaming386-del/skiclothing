export function passwordProblem(pw: string, repeat: string): string | null {
  if (pw.length < 10) return 'Minimaal 10 tekens.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Gebruik letters én cijfers.';
  if (pw !== repeat) return 'De wachtwoorden zijn niet gelijk.';
  return null;
}

export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/** "120", "120,50" of "€ 120.5" → centen; leeg → null. Ongeldig → NaN. */
export function parseEuroToCents(input: string): number | null {
  const t = input.replace(/[€\s]/g, '').replace(',', '.');
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(parseFloat(t) * 100);
}

export function centsToInput(cents: number | null | undefined): string {
  if (cents == null) return '';
  return (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2).replace('.', ',');
}

export function parseIntOrNull(input: string): number | null {
  const t = input.trim();
  if (!t) return null;
  if (!/^-?\d+$/.test(t)) return NaN;
  return parseInt(t, 10);
}

/** HH:mm → geldig? */
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s.trim());
