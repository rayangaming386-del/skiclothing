// Rustige, donkere automotive-stijl. Accentkleur is instelbaar via Bedrijfsinstellingen.
export const colors = {
  bg: '#0B0F14',
  surface: '#141A22',
  surface2: '#1C2430',
  border: '#2A3442',
  text: '#F3F5F8',
  textDim: '#A7B1BF',
  textFaint: '#6B7685',
  primary: '#3B82F6',
  danger: '#EF4444',
  warning: '#F59E0B',
  success: '#22C55E',
  info: '#38BDF8',
  breakFill: '#1A202A',
  blockFill: '#2A1D22',
};

export const statusColors: Record<string, string> = {
  ingepland: '#94A3B8',
  bezig: '#38BDF8',
  afgerond: '#22C55E',
  geannuleerd: '#EF4444',
  niet_verschenen: '#F59E0B',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
export const radius = { sm: 8, md: 12, lg: 16 };
export const font = { small: 13, body: 16, large: 18, title: 22, huge: 28 };

/** Leesbare tekstkleur op een achtergrondkleur. */
export function onColor(hex: string) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? '#0B0F14' : '#FFFFFF';
}

export function withAlpha(hex: string, alpha: number) {
  const a = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}
