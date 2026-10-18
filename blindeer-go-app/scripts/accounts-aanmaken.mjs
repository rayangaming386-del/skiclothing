#!/usr/bin/env node
// Maakt de accounts van het team aan (of werkt ze bij) met gebruikersnaam, e-mailadres en wachtwoord.
// Wachtwoorden en e-mailadressen staan bewust NIET in de code: het script vraagt ze bij het uitvoeren
// (of leest ze uit omgevingsvariabelen, zie onderaan).
//
// Gebruik (in de map blindeer-go-app):
//   SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service-role-key> \
//   SUPABASE_ANON_KEY=<anon-key> node scripts/accounts-aanmaken.mjs
//
// De service-role-sleutel vind je in Supabase → Project Settings → API. Deel die nooit en zet hem nergens in de app.
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const ACCOUNTS = [
  { username: 'BlindeerReus', display_name: 'BlindeerReus', role: 'owner', team: 'Blindeer & Go' },
  { username: 'ProTintMaster', display_name: 'Pro TintMaster', role: 'colleague', team: 'Pro TintMaster' },
  { username: 'TintserviceNL', display_name: 'TintserviceNL', role: 'colleague', team: 'TintserviceNL' },
];

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
if (!URL || !SERVICE) {
  console.error('Zet SUPABASE_URL en SUPABASE_SERVICE_ROLE_KEY (zie de uitleg bovenin dit bestand).');
  process.exit(1);
}
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordProblem = (pw) =>
  pw.length < 10 ? 'minimaal 10 tekens' : !/[A-Za-z]/.test(pw) || !/\d/.test(pw) ? 'gebruik letters én cijfers' : null;

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
        else if (!s.includes('\n')) rl.output.write('*');
        else rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

const envKey = (username, field) => `ACCOUNT_${username.toUpperCase()}_${field}`;

async function findUserByEmail(email) {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

let failures = 0;
for (const acc of ACCOUNTS) {
  console.log(`\n— ${acc.display_name} (gebruikersnaam: ${acc.username}, rol: ${acc.role === 'owner' ? 'eigenaar' : 'collega'})`);
  let email = (process.env[envKey(acc.username, 'EMAIL')] ?? (await ask('  E-mailadres (leeg = overslaan): '))).toLowerCase();
  if (!email) {
    console.log('  overgeslagen');
    continue;
  }
  if (!EMAIL_RE.test(email)) {
    console.log('  ✗ ongeldig e-mailadres, overgeslagen');
    failures++;
    continue;
  }
  const password = process.env[envKey(acc.username, 'PASSWORD')] ?? (await ask('  Wachtwoord: ', { hidden: true }));
  const problem = passwordProblem(password);
  if (problem) {
    console.log(`  ✗ wachtwoord ongeldig (${problem}), overgeslagen`);
    failures++;
    continue;
  }

  try {
    const { data: team, error: teamErr } = await admin.from('teams').select('id').eq('name', acc.team).single();
    if (teamErr) throw new Error(`partij "${acc.team}" niet gevonden — zijn de migraties uitgevoerd?`);
    const app_metadata = { role: acc.role, team_id: team.id, username: acc.username };

    let user = await findUserByEmail(email);
    if (user) {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        password,
        email_confirm: true,
        app_metadata,
        user_metadata: { ...user.user_metadata, display_name: acc.display_name },
      });
      if (error) throw error;
      console.log('  bestaand account bijgewerkt');
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata,
        user_metadata: { display_name: acc.display_name },
      });
      if (error) throw error;
      user = data.user;
      console.log('  account aangemaakt');
    }

    // Profiel expliciet goedzetten (ook bij een bestaand account).
    const { error: profErr } = await admin
      .from('profiles')
      .update({ username: acc.username, display_name: acc.display_name, role: acc.role, team_id: team.id, active: true })
      .eq('id', user.id);
    if (profErr) throw profErr;

    if (ANON) {
      const pub = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data: found } = await pub.rpc('login_email_for', { p_login: acc.username });
      const { error: loginErr } = await pub.auth.signInWithPassword({ email: found ?? '', password });
      if (loginErr) throw new Error(`inlogcontrole mislukt: ${loginErr.message}`);
      await pub.auth.signOut();
      console.log(`  ✓ inloggen met "${acc.username}" gecontroleerd`);
    } else {
      console.log('  ✓ klaar (zet SUPABASE_ANON_KEY om het inloggen ook te laten controleren)');
    }
  } catch (e) {
    failures++;
    console.log(`  ✗ mislukt: ${e.message ?? e}`);
  }
}

console.log(failures ? `\n${failures} account(s) niet gelukt — zie hierboven.` : '\nKlaar.');
process.exit(failures ? 1 : 0);

// Niet-interactief (bijv. voor tests): zet per account
//   ACCOUNT_BLINDEERREUS_EMAIL / ACCOUNT_BLINDEERREUS_PASSWORD
//   ACCOUNT_PROTINTMASTER_EMAIL / ACCOUNT_PROTINTMASTER_PASSWORD
//   ACCOUNT_TINTSERVICENL_EMAIL / ACCOUNT_TINTSERVICENL_PASSWORD
