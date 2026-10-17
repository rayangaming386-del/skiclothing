# Blindeer & Go Planning

Interne mobiele planning-app voor Blindeer & Go, Pro TintMaster en TintserviceNL.
Iedereen heeft een eigen account en werkt in één gedeelde, actuele planning.

- **App:** Expo (React Native, TypeScript). Eén codebase voor iPhone (eerste prioriteit) en Android.
- **Backend:** Supabase: PostgreSQL-database, Auth (accounts), Realtime (live bijwerken), Storage (foto's) en een Edge Function voor teambeheer.
- **Taal/tijd:** Nederlands, euro, alle tijden in de bedrijfstijd `Europe/Amsterdam`, met zomer- en wintertijd.

## Wat zit erin

| Onderdeel | Status |
|---|---|
| Inloggen, uitloggen, ingelogd blijven (versleutelde sessie op het toestel) | ✅ gebouwd en end-to-end getest |
| Wachtwoord vergeten (code per e-mail) | ✅ getest |
| Eigen wachtwoord wijzigen (opnieuw verifiëren), eigen e-mailadres wijzigen (pas actief na bevestiging) | ✅ getest |
| Profielnaam, telefoon, profielfoto, meldingsvoorkeuren, "Mijn account" | ✅ gebouwd (foto-opslag niet lokaal getest, zie hieronder) |
| Uitloggen op andere apparaten | ✅ getest |
| Eigenaar: collega's uitnodigen, rollen/partij instellen, (de)activeren, herstelmail sturen | ✅ getest |
| Uitgeschakeld account verliest direct toegang (ook met lopende sessie) | ✅ getest |
| Rechten afgedwongen in de database (RLS + serverfuncties) | ✅ getest |
| Vandaag-scherm, agenda (dag/week/maand), filters op partij en status | ✅ gebouwd, in browser doorgeklikt |
| Afspraak aanmaken: klant → auto → behandeling(en) → planning → controle | ✅ in browser doorgeklikt |
| Prijs- en duurberekening (carrosserie, ramen, instap, modeluitzonderingen, pakketten, kortingen, handmatige afwijking, "nog te bepalen") | ✅ 45 unit-tests |
| Server-side boekingscontrole: openingstijden, pauzes, buffer, afwijkende dagen, blokkades, afwezigheid, capaciteit (bedrijf, partij, werkplek, medewerker) | ✅ ~60 databasetests |
| Gelijktijdig boeken: precies één boeking slaagt | ✅ getest (8 parallelle sessies en via de API) |
| Gelijktijdige wijziging: geen stil overschrijven (versiecontrole) | ✅ getest |
| Dubbel tikken op opslaan maakt geen dubbele afspraak | ✅ getest |
| Verplaatsen, status wijzigen, annuleren (blijft bewaard), wijzigingshistorie | ✅ getest |
| Bellen en WhatsApp (conceptbericht, nooit automatisch verzonden) | ✅ gebouwd |
| Klantenoverzicht met zoeken op naam/telefoon/kenteken, meerdere auto's, eerdere/komende afspraken | ✅ gebouwd |
| Beheeromgeving zonder code: bedrijfsgegevens, openingstijden, pauzes, afwijkende dagen, blokkades, werkplekken, partijen/kleuren, diensten, folies, prijzen, tijden, modeluitzonderingen, pakketten, kortingen | ✅ gebouwd |
| Live bijwerken bij collega's (Realtime) | ✅ gebouwd, **nog niet getest** (geen Realtime-server in de testomgeving) — als vangnet ververst de app ook bij terugkeer in beeld/na herverbinden |
| Melding bij geen verbinding; niets wordt als "opgeslagen" getoond tenzij de server het bevestigt | ✅ getest |
| Pushmeldingen, betaalstatus, export, kentekenlookup | ⏳ volgende fase (voorkeuren worden al bewaard) |

## Snel starten (ontwikkelaar)

```bash
npm install
cp .env.example .env          # vul je Supabase-URL en publieke (anon) sleutel in
npx expo start                # scan de QR-code met Expo Go of een development build
```

Alle stappen voor de eerste keer inrichten (Supabase-project, migraties, e-mail, eerste beheerder, uitnodigingen)
staan in **[docs/SETUP.md](docs/SETUP.md)**.

## Documentatie

- [docs/SETUP.md](docs/SETUP.md) — Supabase inrichten, eerste beheerder, collega's uitnodigen
- [docs/ARCHITECTUUR.md](docs/ARCHITECTUUR.md) — techniek, beveiliging, synchronisatie, kosten, back-ups
- [docs/TESTEN.md](docs/TESTEN.md) — geautomatiseerde tests en testen op echte telefoons
- [docs/APP-STORE.md](docs/APP-STORE.md) — route naar TestFlight en App Store
- [docs/OPEN-PUNTEN.md](docs/OPEN-PUNTEN.md) — nog af te stemmen bedrijfsregels

## Tests

```bash
npm test                                   # prijs- en tijdzone-unit-tests (Vitest)
npx tsc --noEmit                           # typecontrole
sudo -u postgres ./supabase/tests/run_db_tests.sh   # database: rechten, boekingsregels, gelijktijdig boeken
# End-to-end met echte Supabase Auth + PostgREST: zie docs/TESTEN.md
```

## Mappen

```
src/app/            schermen (Expo Router)
src/components/     UI-componenten (o.a. generieke beheer-editor)
src/lib/            Supabase-client, auth, queries, prijsberekening, tijd
supabase/migrations database-inrichting (schema, rechten, boekingsregels, startgegevens, opslag)
supabase/functions  Edge Function "admin-users" (teambeheer, draait op de server)
supabase/templates  Nederlandse e-mailtemplates (code-gebaseerd)
supabase/tests      database- en end-to-end-tests
```
