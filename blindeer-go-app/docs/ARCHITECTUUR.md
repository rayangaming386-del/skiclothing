# Architectuur, beveiliging en kosten

## Mobiele techniek
**Expo (React Native) met TypeScript, Expo Router** (SDK 58, React Native 0.88).
- Eén codebase levert een echte iOS-app én Android-app. Daarmee hoeft de platformkeuze niet te wachten op het antwoord of iedereen een iPhone heeft.
- Builds, ondertekening en uploaden naar de App Store gebeuren in de cloud met **EAS Build / EAS Submit**; een Mac is niet verplicht.
- Kleine updates (alleen JavaScript) kunnen met **EAS Update** zonder nieuwe App Store-review worden uitgerold; wijzigingen in native onderdelen vragen een nieuwe build.

## Authenticatie
**Supabase Auth** (e-mail + wachtwoord).
- Zelf registreren staat uit; accounts ontstaan alleen via een uitnodiging van de eigenaar (Edge Function `admin-users`, draait op de server met de service-role-sleutel).
- Uitnodiging, wachtwoordherstel, e-mailwijziging en her-authenticatie werken met **6-cijferige codes** per e-mail. Dat werkt op elke telefoon, zonder afhankelijkheid van links die de mail-app wel of niet in de app opent.
- Sessie: korte access-token (1 uur) + refresh-token. Op het toestel **versleuteld** opgeslagen (AES-256; sleutel in iOS Keychain / Android Keystore via SecureStore).
- Wachtwoord wijzigen: eerst huidig wachtwoord opnieuw controleren; eist de server extra bevestiging, dan vraagt de app een code.
- E-mail wijzigen: wachtwoord opnieuw invoeren; nieuw adres pas actief na bevestiging (oud en nieuw adres).
- Uitloggen wist de sessie en alle in het geheugen geladen gegevens. Er wordt geen planning offline op het toestel bewaard.
- "Uitloggen op andere apparaten" beëindigt alle andere sessies van het account.
- Wachtwoorden zijn voor niemand zichtbaar, ook niet voor de eigenaar.

## Database
**PostgreSQL (Supabase)**. Belangrijkste tabellen: `profiles`, `teams` (uitvoerende partijen), `workstations`, `customers`, `vehicles`, `appointments`, `appointment_items`, `appointment_events`, `appointment_photos`, `services`, `service_prices`, `model_exceptions`, `bundles`, `discount_rules`, `opening_hours`, `recurring_breaks`, `date_overrides`, `blocks`, `company_settings`.

- **Momentopname per afspraak:** klant-/autogegevens, behandelingen, prijs per onderdeel, standaardprijs, korting, duur en afwijkingen worden bij de afspraak vastgelegd. Latere catalogus-wijzigingen veranderen bestaande afspraken niet.
- **Historie:** maker en laatste wijziger worden vastgelegd met vaste gebruikers-id én naam op dat moment; elke wijziging komt in `appointment_events`. Afspraken worden nooit verwijderd (annuleren = status).
- **Niets dat historie raakt kan verwijderd worden:** klanten/auto's worden gearchiveerd, diensten/partijen op inactief gezet, accounts uitgeschakeld.
- Bedragen in centen; `NULL` = "nog te bepalen" (nooit automatisch €0).

## Rollen en rechten (afgedwongen in de database)
- Elke tabel heeft **Row Level Security**. Toegang vereist een ingelogd, **actief** profiel. Een uitgeschakeld account ziet direct niets meer — ook met een sessie die nog geldig is — en kan zijn sessie niet meer vernieuwen of opnieuw inloggen (ban).
- Eigenaar: bedrijfsregels, prijzen, catalogus, gebruikers en rollen. Collega: planning, klanten, auto's, blokkades/afwezigheid, eigen profiel.
- Gebruikers kunnen alleen `display_name`, `phone`, `avatar_path`, `notification_prefs` van hun **eigen** profiel wijzigen (kolomrechten); rol/actief/partij alleen via `admin_update_member` (eigenaar) — er blijft altijd minimaal één actieve eigenaar.
- Afspraken zijn **alleen te schrijven via serverfuncties** (`save_appointment`, `set_appointment_status`), zodat alle controles altijd draaien.

## Boekingsregels en gelijktijdig boeken
`save_appointment` draait in één transactie met een **advisory lock**: boekingen worden achter elkaar verwerkt, dus twee collega's kunnen nooit samen de laatste plek pakken. Gecontroleerd worden:
openingstijden (met afwijkende dagen), pauzes, buffer (tussen afspraken en optioneel vóór sluiting), hele-dag- en tijdvakblokkades, afwezigheid, capaciteit van het bedrijf, per uitvoerende partij, per werkplek en per medewerker.
De eigenaar kan openingstijd/pauze/blokkade bewust negeren met een reden (wordt gelogd); capaciteit kan niemand negeren.

- **Idempotent:** elk opslagverzoek heeft een `client_request_id`; herhaald tikken of een netwerk-herhaling levert dezelfde afspraak op.
- **Versiecontrole:** wijzigingen sturen de versie mee; is de afspraak intussen door iemand anders gewijzigd, dan wordt niets overschreven en krijgt de gebruiker een melding.
- Pas na bevestiging door de server toont de app "Opgeslagen".

## Gedeelde wijzigingen bijwerken
- **Supabase Realtime** (respecteert RLS): wijzigingen in afspraken, blokkades, klanten, instellingen e.d. verversen direct de schermen van collega's.
- Vangnet: bij terugkeer van de app naar voorgrond, bij herverbinden en bij pull-to-refresh wordt opnieuw opgehaald.
- Zonder internet toont de app een duidelijke balk; opslaan faalt dan met "er is niets opgeslagen".

## Tijdzone
Alles wordt als UTC opgeslagen en weergegeven in `Europe/Amsterdam` (instelbaar), ook als de telefoon in een andere tijdzone staat. Server-controles rekenen ook in de bedrijfstijdzone; zomer-/wintertijdovergangen zijn getest.

## Geheimen
- In de app: alleen de project-URL en de publieke anon-sleutel (bedoeld voor clients; beveiliging via RLS).
- Service-role-sleutel: alleen in de Edge Function-omgeving van Supabase.
- `.env` staat in `.gitignore`; `.env.example` bevat geen echte waarden.

## Back-up en herstel
1. **Supabase Pro**: dagelijkse automatische back-ups (volgens de huidige documentatie 7 dagen bewaard; Point-in-Time Recovery als betaalde uitbreiding). Herstellen via dashboard → Database → Backups.
2. **Eigen extra back-up**: `scripts/backup.sh` (pg_dump van `public` en `auth`), bijv. wekelijks; bewaar versleuteld (bevat klantgegevens). Terugzetten met `pg_restore` naar een lege database.
3. Test het terugzetten eens per kwartaal op het testproject.

## Externe accounts en terugkerende kosten (indicatief — controleer actuele prijzen)
| Dienst | Waarvoor | Kosten |
|---|---|---|
| Apple Developer Program | TestFlight en App Store | ca. $99 / jaar |
| Google Play Console (alleen als Android nodig is) | Play Store | eenmalig ca. $25 |
| Supabase | database, auth, realtime, opslag | Free (geen back-ups, pauzeert bij inactiviteit) of **Pro ca. $25 / maand** (aanbevolen) |
| Expo / EAS | cloud-builds en updates | gratis tier met beperkt aantal builds per maand; betaald vanaf ca. $19 / maand bij meer gebruik |
| E-mailverzending (SMTP) | uitnodigingen, codes | vaak gratis tot enkele duizenden mails/maand |

Bronnen gebruikt bij het opstellen (oktober 2026, derden — controleer de officiële pagina's): Supabase-prijzen o.a. via schematichq.com/blog/supabase-pricing; Apple: developer.apple.com/support/unlisted-app-distribution.
