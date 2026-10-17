# Inrichten: van nul naar werkende app

Deze stappen voer je één keer uit. Benodigd: een computer met Node.js 20+ en een terminal.
Niets hiervan heb ik (Claude) voor je kunnen uitvoeren: er is nog geen Supabase-project, Apple- of Expo-account gekoppeld.

## 1. Supabase-project aanmaken

1. Maak een account op supabase.com en een **nieuw project**. Kies regio **EU (Frankfurt of Amsterdam/Londen)** — klantgegevens blijven dan in Europa.
2. Bewaar het databasewachtwoord in een wachtwoordmanager.
3. Advies: kies het **Pro-abonnement** zodra je echt gaat werken (dagelijkse back-ups, geen pauze bij inactiviteit). Zie ARCHITECTUUR.md → Kosten.

## 2. Database inrichten (migraties)

Met de Supabase CLI (aanbevolen):

```bash
npx supabase login
npx supabase link --project-ref <project-ref>      # te vinden in de project-URL
npx supabase db push                               # voert supabase/migrations/* uit
```

Alternatief zonder CLI: open in het dashboard **SQL Editor** en voer de bestanden in `supabase/migrations/` uit, in volgorde van bestandsnaam.

De migraties maken:
- alle tabellen, met **Row Level Security** op elke tabel;
- de serverfuncties `save_appointment`, `set_appointment_status`, `available_starts`, `booking_problems`, `admin_update_member`;
- de startgegevens uit de briefing (bedrijfsgegevens, openingstijden, pauzes, partijen, diensten, prijzen, tijden, uitzonderingen). Niet-bevestigde onderdelen (Tesla-pakketten, combinatiekorting) staan **inactief**;
- privé-opslag (buckets) voor afspraakfoto's en profielfoto's;
- Realtime voor de planningtabellen.

`supabase/seed.sql` bevat bewust géén demo-afspraken; echte planning en eventuele testgegevens blijven zo gescheiden.
Advies: gebruik een **apart tweede Supabase-project** als test-/demo-omgeving.

## 3. Authenticatie instellen (dashboard → Authentication)

| Instelling | Waarde | Waarom |
|---|---|---|
| Sign In / Providers → Email → **Allow new users to sign up** | **Uit** | Alleen uitgenodigde accounts |
| Email → **Confirm email** | Aan | |
| Email → **Secure email change** | Aan | Nieuw adres pas actief na bevestiging van oud én nieuw adres |
| Email → **Secure password change** | Aan | Opnieuw verifiëren bij wachtwoordwijziging |
| Email → OTP length / expiry | 6 cijfers / 3600 s | Codes in de e-mails |
| Password → minimum length | 10, letters + cijfers | Komt overeen met de app |
| URL Configuration → Site URL | `blindeergo://auth` | App-schema |
| Anonymous sign-ins | Uit | |

Dezelfde instellingen staan in `supabase/config.toml`; met `npx supabase config push` kun je (een deel ervan) naar het project sturen. Controleer daarna altijd in het dashboard.

### E-mailtemplates (belangrijk)
De app werkt met **6-cijferige codes** (geen links die in de mail-app openen). Zet onder **Authentication → Emails → Templates** de inhoud van:

| Template | Bestand |
|---|---|
| Invite user | `supabase/templates/invite.html` |
| Reset password | `supabase/templates/recovery.html` |
| Change email address | `supabase/templates/email_change.html` |
| Reauthentication | `supabase/templates/reauthentication.html` |
| Magic link | `supabase/templates/magic_link.html` |

### Eigen e-mailverzending (SMTP)
De ingebouwde e-mail van Supabase is alleen voor testen (zeer lage limiet). Stel onder **Authentication → Emails → SMTP Settings** een eigen verzender in (bijv. Postmark, Resend, Brevo of het mailaccount van je domein). Afzender: een adres dat jij beheert. Dit adres heb ik niet ingevuld omdat het niet in de briefing staat.

## 4. Edge Function voor teambeheer uitrollen

```bash
npx supabase functions deploy admin-users
```

De functie gebruikt automatisch `SUPABASE_URL`, `SUPABASE_ANON_KEY` en `SUPABASE_SERVICE_ROLE_KEY` die Supabase zelf aan functies meegeeft. De **service-role-sleutel staat dus alleen op de server**, nooit in de app of in git.

## 5. App koppelen

```bash
cp .env.example .env
```
Vul in vanuit **Project Settings → API**:
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY` (de *anon/publishable* sleutel — die mag in de app; de database beschermt zich via RLS)

Voor EAS-builds zet je dezelfde twee waarden als **EAS environment variables** (omgevingen `preview` en `production`):
```bash
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_URL --value https://<ref>.supabase.co --visibility plaintext
npx eas-cli@latest env:create --environment preview --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value <anon-key> --visibility plaintext
# en hetzelfde voor --environment production
```

## 6. Jezelf als eerste beheerder aanmaken

1. Dashboard → **Authentication → Users → Add user → Send invitation**, met jouw e-mailadres.
2. Dashboard → **SQL Editor**, voer uit (met jouw adres):
   ```sql
   select public.promote_to_owner('jouw@emailadres.nl');
   update public.profiles
      set display_name = 'Rayan — Blindeer & Go',
          team_id = (select id from public.teams where name = 'Blindeer & Go')
    where email = 'jouw@emailadres.nl';
   ```
3. Open de app → **"Uitnodiging ontvangen? Account activeren"** → vul je e-mailadres en de code uit de mail in → kies je wachtwoord.

`promote_to_owner` kan alleen vanuit de SQL Editor (of met de service-role) worden uitgevoerd; via de app kan niemand zichzelf eigenaar maken.

## 7. Pro TintMaster en TintserviceNL uitnodigen

In de app: **Meer → Team & toegang → Collega uitnodigen**. Vul het e-mailadres, de weergavenaam (bijv. "Pro TintMaster"), rol **Collega** en de uitvoerende partij in.
De collega:
1. installeert de app (TestFlight of App Store, zie TESTEN.md / APP-STORE.md);
2. kiest **"Uitnodiging ontvangen? Account activeren"**;
3. vult e-mailadres + code in en kiest een eigen wachtwoord.

Code verlopen? Kies bij het teamlid **"Uitnodiging opnieuw sturen"**. Wachtwoord kwijt? **"Wachtwoordherstel sturen"** of de collega gebruikt zelf "Wachtwoord vergeten?".

## 8. Bedrijfsinstellingen controleren

In de app onder **Meer → Beheer**:
- **Bedrijfsgegevens & regels**: stel vooral **Max. auto's tegelijk** in (staat voorzichtig op 1) en beslis over de buffer vóór sluiting.
- **Pauzes**: bepaal of de pauze 12:00–13:00 ook op zondag geldt.
- **Werkplekken**: optioneel aanmaken.
- **Kortingsregels / Pakketten**: activeren na bevestiging (zie OPEN-PUNTEN.md).
