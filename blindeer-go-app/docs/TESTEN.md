# Testen

## 1. Geautomatiseerde tests (gedraaid tijdens de ontwikkeling)

| Test | Commando | Resultaat bij oplevering |
|---|---|---|
| Prijs-, duur- en tijdzonelogica (gebruikt de echte startgegevens uit de migratie) | `npm test` | 45/45 geslaagd |
| Typecontrole | `npx tsc --noEmit` | geen fouten |
| Database: rechten eigenaar/collega/anoniem, uitschakelen, boekingsregels, pauzes, buffers, capaciteit, blokkades, afwijkende dagen, tijdzone/zomer-wintertijd, versieconflict, idempotentie, annuleren | `sudo -u postgres ./supabase/tests/run_db_tests.sh` | alle ~60 controles geslaagd |
| Gelijktijdig boeken (8 parallelle databasesessies, capaciteit 1) | onderdeel van bovenstaande | 1 geaccepteerd, 7 geweigerd (zonder lock: 8 geaccepteerd — de test is dus zinvol) |
| End-to-end met echte **Supabase Auth v2.186** + PostgREST + Edge Function + mail-opvang | zie hieronder | 39/39 geslaagd |
| iOS-, Android- en web-bundel bouwen | `npx expo export --platform ios` | geslaagd |
| App doorgeklikt in Chromium (telefoonformaat, tijdzone New York) | Playwright | inloggen → klant → auto → behandeling → planning → opslaan → agenda/account/team: geslaagd, tijden in NL-tijd |

De end-to-end-test controleert: eerste beheerder, zelf registreren geblokkeerd, uitnodiging + code + eigen wachtwoord voor Pro TintMaster en TintserviceNL, uitloggen (sessie ongeldig), fout wachtwoord, rechten collega/eigenaar, afspraak zichtbaar bij alle accounts, verplaatsen, versieconflict, gelijktijdig boeken door drie accounts, dubbel tikken, annuleren + historie, wachtwoord vergeten, herstelmail door eigenaar, eigen wachtwoord wijzigen (met en zonder code), e-mail wijzigen (pas actief na bevestiging), uitloggen op andere apparaten, uitschakelen (lopende sessie verliest direct toegang, vernieuwen/inloggen geweigerd), heractiveren, geen wachtwoorden in teamoverzicht, netwerkfout.

**Niet automatisch getest:** Realtime-push naar collega's (vereist de Realtime-server van Supabase), uploaden van foto's (Storage), echte e-mailbezorging via SMTP, en de app op een fysieke iPhone/Android. Die controleer je met de checklist hieronder.

### End-to-end lokaal draaien
Vereist PostgreSQL, Node, Python 3 en twee binaries in een map (`BIN_DIR`):
- Supabase Auth: `https://github.com/supabase/auth/releases` → `auth-v2.x-x86.tar.gz`, uitpakken naar `$BIN_DIR/auth/`
- PostgREST: `https://github.com/PostgREST/postgrest/releases` → `postgrest` naar `$BIN_DIR/`

```bash
BIN_DIR=/pad/naar/bin ./supabase/tests/e2e/start_stack.sh
node --experimental-strip-types supabase/tests/e2e/e2e.test.mjs
./supabase/tests/e2e/stop_stack.sh
```
(Postgres-gebruiker `postgres` met wachtwoord `postgres` op 127.0.0.1; alleen voor deze lokale test.)

## 2. Op echte telefoons testen

### Snel tijdens ontwikkeling (Expo Go)
Alle gebruikte native modules zitten in Expo Go. Installeer **Expo Go** op de telefoon, start `npx expo start` op je computer en scan de QR-code. Werkt alleen als de Expo Go-versie SDK 58 ondersteunt; anders gebruik je een build (hieronder).

### iPhone: TestFlight (aanbevolen voor jullie drieën)
1. Apple Developer Program-lidmaatschap (zie APP-STORE.md).
2. `npx eas-cli@latest login` en `npx eas-cli@latest init` (koppelt het project aan Expo).
3. `npx eas-cli@latest update:configure` (voor updates zonder nieuwe build).
4. `npx eas-cli@latest build --platform ios --profile production` — EAS maakt certificaten en profielen aan.
5. `npx eas-cli@latest submit --platform ios` — upload naar App Store Connect.
6. App Store Connect → TestFlight → voeg jezelf en collega's toe als testers (interne testers: geen review nodig; externe testers: korte beta-review).
7. Testers installeren **TestFlight** en de app.

### Android
`npx eas-cli@latest build --platform android --profile preview` levert een installeerbaar APK/AAB-bestand met een downloadlink (interne distributie), zonder Play Store.

### Testchecklist op de telefoon
- [ ] Inloggen, app sluiten en heropenen: nog ingelogd.
- [ ] Uitnodiging accepteren met code (op de telefoon van de collega).
- [ ] Wachtwoord vergeten → code → nieuw wachtwoord.
- [ ] Afspraak maken op telefoon A → verschijnt binnen enkele seconden op telefoon B zonder verversen (**Realtime**).
- [ ] Afspraak verplaatsen op B → zichtbaar op A.
- [ ] Tegelijk op A en B dezelfde laatste plek boeken → één lukt, de ander krijgt "Dit tijdstip kan niet".
- [ ] Vliegtuigmodus aan → oranje balk; opslaan geeft "er is niets opgeslagen".
- [ ] Foto toevoegen bij een afspraak; zichtbaar bij collega.
- [ ] Bellen- en WhatsApp-knop (WhatsApp opent met concept, niets wordt verstuurd).
- [ ] Telefoon op een andere tijdzone zetten → afspraken blijven in Nederlandse tijd.
- [ ] Collega uitschakelen → collega ziet direct "Account uitgeschakeld".
