# Online zetten: van nul naar werkende website-app

De planning draait als **website** die je op de telefoon op het beginscherm zet (geen App Store of Play Store nodig).
Je hebt twee gratis/goedkope diensten nodig: **Supabase** (database + inloggen) en **Vercel** (de website zelf).
Reken op ongeveer een uur. Nog niets hiervan is al gedaan: er bestaat nog geen Supabase-project of website.

Benodigd op je computer: [Node.js 20 of nieuwer](https://nodejs.org) en een terminal.

---

## Stap 1 — Supabase-project (database en accounts)

1. Maak een account op **supabase.com** → **New project**.
   - Naam: `blindeer-go-planning`, regio **Europe (Frankfurt)**, kies en bewaar een sterk databasewachtwoord.
   - Abonnement: Free werkt; **Pro (± $25/maand)** wordt aangeraden voor dagelijkse back-ups.
2. Ga naar **Project Settings → API** en noteer:
   - **Project URL** (`https://xxxx.supabase.co`)
   - **anon / publishable key** (mag in de website)
   - **service_role / secret key** (geheim! alleen voor stap 4, nooit delen of in de website zetten)

## Stap 2 — Database inrichten

In een terminal, in de map `blindeer-go-app`:

```bash
npm install
npx supabase login
npx supabase link --project-ref <xxxx>      # het deel tussen https:// en .supabase.co
npx supabase db push                        # voert alle bestanden in supabase/migrations uit
npx supabase functions deploy admin-users   # teambeheer (uitnodigen, uitschakelen)
```

Daarmee staan klaar: alle tabellen met beveiliging, de boekingsregels, jullie prijzen (incl. compleet-pakketten en
€10 combinatiekorting), openingstijden, pauzes (ma–za), werkplek Binckhorst en capaciteit 1 auto tegelijk.

## Stap 3 — Inloggen en e-mail instellen (Supabase-dashboard)

**Authentication → Sign In / Providers → Email**
- *Allow new users to sign up*: **uit** (alleen jullie accounts)
- *Confirm email*: aan · *Secure email change*: aan · *Secure password change*: aan
- Minimale wachtwoordlengte: **10**

**Authentication → Emails → SMTP Settings** (verzenden vanaf `rayanattalhaoui123@gmail.com`)
1. Zet op dat Google-account **2-stapsverificatie** aan.
2. Maak bij Google → Beveiliging → **App-wachtwoorden** een app-wachtwoord aan (16 tekens).
3. Vul in Supabase in: Host `smtp.gmail.com`, Port `587`, Username `rayanattalhaoui123@gmail.com`,
   Password = het app-wachtwoord, Sender email `rayanattalhaoui123@gmail.com`, Sender name `Blindeer & Go Planning`.

**Authentication → Emails → Templates**: plak de inhoud van de bestanden in `supabase/templates/`
(Invite → `invite.html`, Reset password → `recovery.html`, Change email → `email_change.html`,
Reauthentication → `reauthentication.html`). Die mails bevatten een code die je in de app invult.

## Stap 4 — Accounts aanmaken (BlindeerReus, ProTintMaster, TintserviceNL)

```bash
SUPABASE_URL=https://<xxxx>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service_role-key> \
SUPABASE_ANON_KEY=<anon-key> \
node scripts/accounts-aanmaken.mjs
```

Het script vraagt per account het e-mailadres en het wachtwoord (die staan bewust niet in de code), maakt het account aan
en controleert meteen of inloggen met de gebruikersnaam werkt:

| Gebruikersnaam | Naam in de app | Rol | Partij |
|---|---|---|---|
| BlindeerReus | BlindeerReus | Eigenaar | Blindeer & Go |
| ProTintMaster | Pro TintMaster | Collega | Pro TintMaster |
| TintserviceNL | TintserviceNL | Collega | TintserviceNL |

Inloggen kan daarna met de **gebruikersnaam óf het e-mailadres** (hoofdletters maken niet uit).
Script nogmaals draaien = wachtwoorden bijwerken; er ontstaan geen dubbele accounts.
Later meer collega's? In de app: **Meer → Team & toegang → Collega uitnodigen** (met gebruikersnaam).

## Stap 5 — Website online zetten (Vercel, gratis)

1. Maak een account op **vercel.com** en kies **Add New → Project → Import Git Repository** → kies de repo met deze app.
2. **Root Directory**: `blindeer-go-app`. Build-instellingen komen uit `vercel.json` (niets aanpassen).
   De app staat in de StrakWerk-repo op de branch **`claude/blindeer-go-planner`** (zodat de StrakWerk-website op `main`
   ongemoeid blijft): zet in Vercel → Settings → Git de **Production Branch** op die branch.
3. **Environment Variables**:
   - `EXPO_PUBLIC_SUPABASE_URL` = je Project URL
   - `EXPO_PUBLIC_SUPABASE_ANON_KEY` = je anon key
4. **Deploy**. Je krijgt een adres zoals `blindeer-go-planning.vercel.app` (een eigen domein kan later via Vercel → Domains).
5. Zet in Supabase → **Authentication → URL Configuration → Site URL** dat adres.

Netlify of Cloudflare Pages kan ook (`netlify.toml` en `public/_redirects` staan klaar; build `npx expo export --platform web`, map `dist`).

Elke wijziging die naar de gekoppelde branch wordt gepusht, zet Vercel automatisch online.

## Stap 6 — Op de telefoon zetten

- **iPhone**: open het adres in **Safari** → Deel-knop → **Zet op beginscherm** → Voeg toe.
- **Android**: open in **Chrome** → ⋮ → **Toevoegen aan startscherm / App installeren**.
- Open daarna de app via het icoon en log één keer in. In de app staat dit ook uitgelegd (Meer → Op beginscherm zetten).

## Stap 7 — Controleren

Log in als BlindeerReus en kijk bij **Meer → Bedrijfsgegevens & regels**, **Openingstijden**, **Pauzes**,
**Pakketten** en **Kortingsregels** of alles klopt. Maak een test-afspraak, controleer dat een collega hem ziet en annuleer hem.
