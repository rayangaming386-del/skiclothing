// Hulpmiddelen voor de webversie die als app op het beginscherm staat.
import { Platform } from 'react-native';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

let deferredPrompt: InstallPrompt | null = null;
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  // Android/Chrome: bewaar het installatieverzoek zodat we een eigen knop kunnen tonen.
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e as InstallPrompt;
  });
}

export const isWeb = Platform.OS === 'web';

/** Draait de website als app vanaf het beginscherm? */
export function isStandalone(): boolean {
  if (!isWeb || typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function deviceKind(): 'ios' | 'android' | 'other' {
  if (!isWeb || typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document)) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'other';
}

export const canPromptInstall = () => !!deferredPrompt;

export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return outcome === 'accepted';
}

/** Per toestel onthouden dat de tip is weggeklikt (alleen een gemak; niet gevoelig). */
export function hintDismissed(): boolean {
  try {
    return isWeb && window.localStorage.getItem('bg-install-hint') === 'weg';
  } catch {
    return false;
  }
}
export function dismissHint() {
  try {
    if (isWeb) window.localStorage.setItem('bg-install-hint', 'weg');
  } catch {
    /* negeren */
  }
}
