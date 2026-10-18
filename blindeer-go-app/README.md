# Blindeer & Go Planning

Interne planning voor Blindeer & Go, Pro TintMaster en TintserviceNL: één gedeelde agenda, eigen accounts, werkt als
**website-app op het beginscherm** van iPhone en Android (geen App Store nodig).

- **Techniek:** Expo / React Native Web (TypeScript) + Supabase (database, inloggen, live bijwerken, foto-opslag).
- **Taal/tijd:** Nederlands, euro, alle tijden in Nederlandse tijd (`Europe/Amsterdam`), zomer-/wintertijd inbegrepen.
- **Online zetten:** zie **[docs/SETUP.md](docs/SETUP.md)** (Supabase + Vercel, ±1 uur).

## Wat de app kan

**Plannen**
- *Vandaag*: datum, eerstvolgende afspraak, aantallen vandaag / deze week / deze maand, grote knop "Afspraak toevoegen".
- *Afspraak maken op één scherm*: klant → auto → behandeling → wanneer & wie. Blokken klappen dicht met een samenvatting;
  onderaan staan altijd prijs, tijd en "Opslaan". Snelkeuzes: **Compleet + kameleon**, **Compleet + zwarte voorruit**,
  B-stijl + voorportieren, B-stijl + kameleon. Eigen partij en werkplek Binckhorst staan standaard ingevuld.
- Alleen echt vrije starttijden worden getoond (openingstijden, pauzes, buffer, blokkades, 1 auto tegelijk).
- *Agenda*: dag (met pauzes en blokkades), week en maand; filters op partij en status.
- *Afspraak*: bewerken, verplaatsen, status, bellen, WhatsApp (concept), foto's, annuleren (blijft bewaard), volledige historie.
- *Klanten*: zoeken op naam, telefoon of kenteken; meerdere auto's; eerdere en komende afspraken.

**Overzicht** (nieuw)
- Aantal auto's gepland per **week, maand, jaar en alles**, met afgerond / nog te komen / geannuleerd / niet verschenen.
- Geplande en afgeronde omzet, per partij, per behandeling, staafdiagram per dag of maand.
- Export naar Excel (CSV).

**Prijzen** (automatisch, altijd handmatig aan te passen)
- B-stijl per carrosserie en ramen, voorportieren, voorruit (gewone/hoge instap), modeluitzonderingen (Golf 5/6, Micra 2003, Peugeot 307).
- Complete auto: hatchback €290/€280, sedan €320/€300, station 7 ramen €330, station 5 ramen €300.
- €10 korting op voorportieren bij elke combinatie. Onbekende prijzen = "nog te bepalen", nooit €0.

**Accounts en beveiliging**
- Inloggen met **gebruikersnaam of e-mailadres**; wachtwoord vergeten, eigen wachtwoord en e-mailadres wijzigen (met code).
- Eigenaar (BlindeerReus): collega's uitnodigen, rollen/partij/gebruikersnaam instellen, accounts uitschakelen, herstelmail sturen.
- Rechten worden door de database afgedwongen; een uitgeschakeld account verliest direct toegang.
- Gelijktijdig boeken kan nooit dubbel; gelijktijdige wijzigingen worden niet stil overschreven; dubbel tikken maakt geen dubbele afspraak.

## Tests (allemaal geslaagd bij oplevering)

| Wat | Commando | Resultaat |
|---|---|---|
| Prijzen, pakketten, kortingen, tijdzone | `npm test` | 63/63 |
| Typecontrole | `npx tsc --noEmit` | geen fouten |
| Database: rechten, boekingsregels, pauzes, gebruikersnaam, overzicht, gelijktijdig boeken | `sudo -u postgres ./supabase/tests/run_db_tests.sh` | 103 controles |
| End-to-end met echte Supabase Auth + database + Edge Function | zie docs/TESTEN.md | 47 controles |
| Website doorgeklikt op telefoonformaat (inloggen met gebruikersnaam → compleet-afspraak → opslaan → status → overzicht → export → beheer → uitloggen) | Playwright | geslaagd, geen fouten |

## Mappen

```
src/app/            schermen (Expo Router)
src/components/     UI-componenten
src/lib/            Supabase-client, prijsberekening, tijd, overzicht/export
public/             website: icoon, manifest (beginscherm), index.html
supabase/migrations database-inrichting en bedrijfsregels
supabase/functions  serverfunctie teambeheer
scripts/            accounts aanmaken, back-up
docs/               SETUP, ARCHITECTUUR, TESTEN, OPEN-PUNTEN
```
