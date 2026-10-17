// Vertaalt fouten van Supabase/netwerk naar begrijpelijke Nederlandse meldingen.

export interface FriendlyError {
  title: string;
  message: string;
  kind: 'conflict' | 'rules' | 'network' | 'auth' | 'permission' | 'other';
  problems?: { code: string; message: string; overridable: boolean }[];
}

type AnyErr = { message?: string; hint?: string | null; details?: string | null; code?: string; status?: number; name?: string };

export function toFriendlyError(e: unknown): FriendlyError {
  const err = (e ?? {}) as AnyErr;
  const msg = err.message ?? String(e);

  if (msg.includes('VERSIE_CONFLICT')) {
    let who = '';
    try {
      who = JSON.parse(err.details ?? '{}').updated_by_name ?? '';
    } catch {
      /* ignore */
    }
    return {
      kind: 'conflict',
      title: 'Afspraak is intussen gewijzigd',
      message: `${who ? who + ' heeft' : 'Iemand anders heeft'} deze afspraak net aangepast. Je wijziging is NIET opgeslagen. De nieuwste versie wordt geladen; controleer en probeer opnieuw.`,
    };
  }
  if (msg.includes('BOEKING_NIET_MOGELIJK')) {
    let problems: FriendlyError['problems'];
    try {
      problems = JSON.parse(err.details ?? '[]');
    } catch {
      problems = undefined;
    }
    return {
      kind: 'rules',
      title: 'Dit tijdstip kan niet',
      message: err.hint ?? 'Het tijdstip botst met de planning of de bedrijfsregels.',
      problems,
    };
  }
  if (/network request failed|failed to fetch|fetch failed|timeout|offline/i.test(msg) || err.name === 'AuthRetryableFetchError') {
    return {
      kind: 'network',
      title: 'Geen verbinding',
      message: 'De server is niet bereikbaar. Er is niets opgeslagen. Controleer je internet en probeer opnieuw.',
    };
  }
  if (err.code === '42501' || /permission denied|row-level security|Geen toegang|Alleen de eigenaar/i.test(msg)) {
    return { kind: 'permission', title: 'Geen toestemming', message: msg.startsWith('Alleen') ? msg : 'Je hebt geen rechten voor deze actie.' };
  }
  if (/Invalid login credentials/i.test(msg)) {
    return { kind: 'auth', title: 'Inloggen mislukt', message: 'E-mailadres of wachtwoord klopt niet.' };
  }
  if (/User is banned|user_banned/i.test(msg)) {
    return { kind: 'auth', title: 'Account uitgeschakeld', message: 'Dit account is uitgeschakeld. Neem contact op met de beheerder.' };
  }
  if (/Token has expired or is invalid|otp_expired|invalid.*otp/i.test(msg)) {
    return { kind: 'auth', title: 'Code ongeldig', message: 'De code is onjuist of verlopen. Vraag een nieuwe code aan.' };
  }
  if (/Password should|weak_password|password.*(characters|length)/i.test(msg)) {
    return { kind: 'auth', title: 'Wachtwoord te zwak', message: 'Kies een wachtwoord van minimaal 10 tekens met letters en cijfers.' };
  }
  if (/same_password|different from the old/i.test(msg)) {
    return { kind: 'auth', title: 'Zelfde wachtwoord', message: 'Kies een ander wachtwoord dan je huidige.' };
  }
  if (/reauthentication/i.test(msg)) {
    return { kind: 'auth', title: 'Bevestiging nodig', message: 'Bevestig eerst je identiteit met de code uit je e-mail.' };
  }
  if (/rate limit|too many|security purposes/i.test(msg)) {
    return { kind: 'other', title: 'Even wachten', message: 'Te veel pogingen achter elkaar. Probeer het over een minuut opnieuw.' };
  }
  if (/already.*registered|email_exists|already exists/i.test(msg)) {
    return { kind: 'other', title: 'E-mailadres in gebruik', message: 'Er bestaat al een account met dit e-mailadres.' };
  }
  return { kind: 'other', title: 'Er ging iets mis', message: msg || 'Onbekende fout.' };
}
