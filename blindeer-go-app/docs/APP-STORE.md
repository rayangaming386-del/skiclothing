# Route naar de App Store

> Status bij oplevering: **de code is klaar en gebundeld, maar er is nog geen build ingediend, niets is gepubliceerd en niets is door Apple goedgekeurd.** Onderstaande stappen moet jij (of iemand met toegang tot jullie Apple-account) uitvoeren.

## Keuze: gewone, unlisted of custom app?

| Optie | Wat het is | Past het? |
|---|---|---|
| **TestFlight** | Testdistributie, builds 90 dagen geldig | Ideaal voor de testfase met jullie drieën |
| **Unlisted App Store-app** | Volwaardige App Store-app, niet vindbaar via zoeken/categorieën; alleen via directe link | **Aanbevolen** voor dit interne gebruik |
| Gewone (publieke) App Store-app | Vindbaar voor iedereen | Kan, maar onnodig; toegang is sowieso alleen via jullie accounts |
| Custom app via Apple Business Manager | Alleen voor organisaties in Apple Business Manager | Mogelijk, maar vraagt extra registratie (o.a. D-U-N-S); meer gedoe voor 3 gebruikers |

Unlisted: de app doorloopt de normale App Review. Daarna vraag je via Apple's formulier unlisted-distributie aan (alleen de Account Holder kan dat), met de vermelding in de reviewnotities dat de app voor intern gebruik is. Apple beoordeelt dit en mailt het resultaat. Bron: developer.apple.com/support/unlisted-app-distribution. Wat er ook gekozen wordt: de app blijft beveiligd door jullie accounts.

## Stappen

1. **Apple Developer Program** — aanmelden als organisatie (vereist D-U-N-S-nummer en de juiste juridische bedrijfsnaam — die staat nog niet in de briefing) of als individu (verkoper toont dan je eigen naam). Ca. $99 per jaar.
2. **Bundle ID** — in `app.json` staat voorlopig `nl.blindeergo.planning`. Pas aan als je een andere naam wilt; na de eerste upload ligt het vast.
3. **App-icoon en naam** — er is nog geen definitief logo. Vervang `assets/icon.png` (1024×1024, geen transparantie) en de Android-iconen. Naam in de App Store: bijv. "Blindeer & Go Planning".
4. **Build en ondertekening** — `npx eas-cli@latest build -p ios --profile production`. EAS beheert certificaat en provisioning profile (inloggen met je Apple-ID).
5. **Uploaden** — `npx eas-cli@latest submit -p ios`.
6. **App Store Connect invullen**
   - Beschrijving, trefwoorden, categorie (Zakelijk / Productiviteit), support-URL.
   - **Privacybeleid-URL (verplicht)** — moet nog geschreven en gepubliceerd worden; niet verzonnen in deze oplevering.
   - **App Privacy ("privacy-etiketten")**: gegevens die worden verzameld en aan de gebruiker gekoppeld, niet voor tracking:
     - Contactgegevens: naam, e-mailadres, telefoonnummer (gebruikers én klanten);
     - Foto's (bij afspraken en profielfoto);
     - Identifiers: gebruikers-ID;
     - Overige: interne notities, afspraakgegevens.
     Geen advertenties, geen analytics/tracking in deze versie.
   - **Exportcompliance**: de app gebruikt alleen standaardversleuteling (HTTPS, Keychain) — `usesNonExemptEncryption: false` staat al in app.json.
   - **Leeftijdsclassificatie**: 4+.
   - **Schermafbeeldingen**: verplicht voor iPhone 6,9" (en eventueel 6,5"). Maak ze op een simulator of telefoon met een **demo-omgeving** (geen echte klantgegevens tonen!).
7. **Inloggegevens voor de reviewer** — Apple moet kunnen inloggen. Belangrijk: een reviewer-account in de echte omgeving ziet echte klantgegevens. Opties:
   - een tijdelijk reviewer-account aanmaken en na goedkeuring direct uitschakelen (eenvoudig, maar Apple ziet echte data);
   - beter: een **apart demo-Supabase-project** met nepdata en de reviewbuild daarop laten wijzen. Dit is een keuze voor jou (zie OPEN-PUNTEN.md).
   Vermeld in de reviewnotities dat het een interne app is zonder zelfregistratie.
8. **Account verwijderen** — Apple eist een verwijdermogelijkheid in apps waar je zelf een account kunt aanmaken. Hier maakt de eigenaar accounts aan; toch kan een reviewer ernaar vragen. Mogelijke aanvulling: knop "Verwijdering van mijn account aanvragen" (account uitschakelen + verzoek aan eigenaar), zonder afspraakhistorie te verliezen.
9. **Indienen voor review** — reken op 1–3 dagen; bij afwijzing volgen aanpassingen.
10. **Unlisted aanvragen** (na goedkeuring of tijdens review) en de link delen met collega's.

## Updates
- Alleen JavaScript/schermen gewijzigd: `npx eas-cli@latest update --channel production --message "..."` — telefoons halen het bij de volgende start op.
- Native wijzigingen (nieuwe module, SDK-upgrade, rechten): nieuwe build + submit + review.
- Databasewijzigingen: nieuwe migratie in `supabase/migrations/` en `npx supabase db push` — altijd eerst op het testproject.

## Android (als collega's dat nodig hebben)
Google Play Console-account (eenmalig ca. $25), `eas build -p android --profile production` en `eas submit -p android`. Voor intern gebruik kan de Play Store-track "Interne test" of een besloten track volstaan.
