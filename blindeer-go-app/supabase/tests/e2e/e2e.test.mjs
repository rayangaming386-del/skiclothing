// End-to-end test tegen een echte Supabase Auth (GoTrue) + PostgREST + Edge Function.
// Start eerst ./start_stack.sh. Draaien: node --experimental-strip-types supabase/tests/e2e/e2e.test.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '../../..');
const require = createRequire(path.join(appRoot, 'package.json'));
const { createClient } = require('@supabase/supabase-js');
const { toFriendlyError } = await import(path.join(appRoot, 'src/lib/errors.ts'));

const env = Object.fromEntries(
  fs.readFileSync(path.join(here, '.run/env'), 'utf8').trim().split('\n').map((l) => l.split(/=(.*)/s).slice(0, 2)),
);
const URL = env.SUPABASE_URL;
const ANON = env.SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

let passed = 0;
const ok = (name) => {
  passed++;
  console.log(`ok - ${name}`);
};
const client = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const sql = (q) => execFileSync('psql', ['-X', '-At', '-h', '127.0.0.1', '-U', 'postgres', '-d', env.DB, '-c', q], { env: { ...process.env, PGPASSWORD: 'postgres' } }).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mails() {
  return fs.readFileSync(env.MAIL_LOG, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
async function waitForCode(to, since, subjectRe) {
  for (let i = 0; i < 50; i++) {
    const m = mails().slice(since).filter((x) => x.to.includes(to.toLowerCase()) && (!subjectRe || subjectRe.test(x.subject)));
    if (m.length) {
      const body = m[m.length - 1].body.replace(/=\r?\n/g, '');
      const code = body.match(/>\s*(\d{6})\s*</)?.[1] ?? body.match(/\b(\d{6})\b/)?.[1];
      assert.ok(code, `geen code in mail aan ${to}`);
      return { code, mail: m[m.length - 1] };
    }
    await sleep(200);
  }
  throw new Error(`geen mail ontvangen voor ${to} (${subjectRe})`);
}
async function rpc(c, fn, args) {
  const { data, error } = await c.rpc(fn, args);
  if (error) throw error;
  return data;
}
async function expectError(promiseFn, re, name) {
  try {
    const res = await promiseFn();
    if (res && res.error) {
      assert.match(`${res.error.message} ${res.error.hint ?? ''} ${res.error.details ?? ''}`, re);
      return ok(name);
    }
  } catch (e) {
    assert.match(`${e.message} ${e.hint ?? ''} ${e.details ?? ''}`, re, name);
    return ok(name);
  }
  throw new Error(`verwachte fout bleef uit: ${name}`);
}
const PW = 'Startwachtwoord123';

// ---------------------------------------------------------------------------
// 1. Eerste beheerder (zoals in docs/SETUP.md: account aanmaken + promote_to_owner)
// ---------------------------------------------------------------------------
{
  const { error } = await admin.auth.admin.createUser({ email: 'rayan@e2e.test', password: PW, email_confirm: true, user_metadata: { display_name: 'Rayan — Blindeer & Go' } });
  assert.ifError(error);
  sql(`select public.promote_to_owner('rayan@e2e.test')`);
  sql(`update public.profiles set team_id = (select id from public.teams where name = 'Blindeer & Go') where email = 'rayan@e2e.test'`);
}
const owner = client();
{
  const { data, error } = await owner.auth.signInWithPassword({ email: 'rayan@e2e.test', password: PW });
  assert.ifError(error);
  const { data: p } = await owner.from('profiles').select('*').eq('id', data.user.id).single();
  assert.equal(p.role, 'owner');
  ok('eerste beheerder kan inloggen en is eigenaar');
}

// Zelf registreren is uitgeschakeld
await expectError(() => client().auth.signUp({ email: 'vreemde@e2e.test', password: PW }), /not allowed|disabled/i, 'zelf registreren is geblokkeerd');

// ---------------------------------------------------------------------------
// 2. Uitnodigingsflow voor Pro TintMaster en TintserviceNL
// ---------------------------------------------------------------------------
const teamId = (name) => sql(`select id from public.teams where name = '${name}'`);
async function inviteAndActivate(email, name, team) {
  const since = mails().length;
  const { data, error } = await owner.functions.invoke('admin-users', { body: { action: 'invite', email, display_name: name, role: 'colleague', team_id: teamId(team) } });
  assert.ifError(error);
  assert.ok(data.user_id);
  const { code, mail } = await waitForCode(email, since, /Uitnodiging/);
  assert.match(mail.body, /Account activeren|Uitnodiging accepteren/);
  const c = client();
  const v = await c.auth.verifyOtp({ email, token: code, type: 'invite' });
  assert.ifError(v.error);
  const u = await c.auth.updateUser({ password: PW });
  assert.ifError(u.error);
  return c;
}
const pro = await inviteAndActivate('pro@e2e.test', 'Pro TintMaster', 'Pro TintMaster');
ok('Pro TintMaster: uitnodiging ontvangen, code bevestigd, eigen wachtwoord gekozen');
const tsn = await inviteAndActivate('tsn@e2e.test', 'TintserviceNL', 'TintserviceNL');
ok('TintserviceNL: uitnodiging ontvangen, code bevestigd, eigen wachtwoord gekozen');
{
  const { data } = await pro.from('profiles').select('display_name, role, team_id, email').eq('email', 'pro@e2e.test').single();
  assert.deepEqual([data.display_name, data.role, data.team_id], ['Pro TintMaster', 'colleague', teamId('Pro TintMaster')]);
  ok('profiel collega: naam, rol collega en uitvoerende partij uit de uitnodiging');
}
await expectError(
  () => owner.functions.invoke('admin-users', { body: { action: 'invite', email: 'pro@e2e.test', display_name: 'x', role: 'colleague' } }),
  /non-2xx|409|bestaat al/i,
  'dubbele uitnodiging voor bestaand e-mailadres wordt geweigerd',
);

// Uitloggen en opnieuw inloggen
{
  const c = client();
  assert.ifError((await c.auth.signInWithPassword({ email: 'pro@e2e.test', password: PW })).error);
  const { data: s } = await c.auth.getSession();
  const refresh = s.session.refresh_token;
  assert.ifError((await c.auth.signOut()).error);
  const again = await client().auth.refreshSession({ refresh_token: refresh });
  assert.ok(again.error, 'refresh-token moet ongeldig zijn na uitloggen');
  ok('uitloggen maakt de sessie ongeldig (refresh-token werkt niet meer)');
}
await expectError(() => client().auth.signInWithPassword({ email: 'pro@e2e.test', password: 'verkeerd123456' }), /Invalid login credentials/, 'inloggen met fout wachtwoord geweigerd');

// ---------------------------------------------------------------------------
// 3. Rechten: collega vs eigenaar (server-side)
// ---------------------------------------------------------------------------
await expectError(() => pro.functions.invoke('admin-users', { body: { action: 'list' } }), /non-2xx|403/i, 'collega kan teambeheer-functie niet gebruiken');
{
  const { data } = await pro.from('company_settings').update({ default_buffer_min: 0 }).eq('id', 1).select();
  assert.equal(data.length, 0);
  assert.equal(sql('select default_buffer_min from public.company_settings'), '15');
  ok('collega kan bedrijfsregels niet wijzigen');
  const { data: d2 } = await owner.from('company_settings').update({ slot_interval_min: 15 }).eq('id', 1).select();
  assert.equal(d2.length, 1);
  ok('eigenaar kan bedrijfsregels wijzigen');
}
await expectError(() => pro.from('service_prices').insert({ service_id: sql(`select id from public.services where code='bstijl'`), label: 'x', price_cents: 1 }), /row-level security/, 'collega kan geen prijzen toevoegen');
await expectError(() => pro.rpc('admin_update_member', { p_user_id: sql(`select id from public.profiles where email='tsn@e2e.test'`), p_role: 'owner' }), /Alleen de eigenaar/, 'collega kan geen rollen wijzigen');
await expectError(() => client().from('appointments').select('*'), /permission denied/, 'zonder inloggen geen toegang tot afspraken');

// ---------------------------------------------------------------------------
// 4. Afspraak toevoegen, zichtbaar bij collega's, verplaatsen, conflict, annuleren
// ---------------------------------------------------------------------------
const { data: cust, error: custErr } = await pro.from('customers').insert({ name: 'E2E Klant', phone: '06 12345678' }).select().single();
assert.ifError(custErr);
const { data: veh } = await pro.from('vehicles').insert({ customer_id: cust.id, make: 'Volkswagen', model: 'Golf 5', body_type: 'hatchback', rear_window_count: 5 }).select().single();
const payload = (over = {}) => ({
  client_request_id: crypto.randomUUID(),
  customer_id: cust.id,
  vehicle_id: veh.id,
  customer_name: 'E2E Klant',
  customer_phone: '06 12345678',
  vehicle: { make: 'Volkswagen', model: 'Golf 5', body_type: 'hatchback', rear_window_count: 5 },
  starts_at: '2026-11-16T09:00:00Z', // maandag 10:00 NL
  duration_min: 90,
  team_id: teamId('Pro TintMaster'),
  items: [{ service_name: 'Blinderen vanaf de B-stijl', model_exception_label: 'Volkswagen Golf 5, B-stijl', standard_price_cents: 15000, price_cents: 15000, duration_min: 90 }],
  ...over,
});
const first = await rpc(pro, 'save_appointment', { p: payload() });
const apptId = first.appointment.id;
{
  const { data } = await owner.from('appointments').select('*, appointment_items(*)').eq('id', apptId).single();
  assert.equal(data.created_by_name, 'Pro TintMaster');
  assert.equal(data.price_total_cents, 15000);
  assert.equal(data.appointment_items[0].model_exception_label, 'Volkswagen Golf 5, B-stijl');
  ok('afspraak van Pro TintMaster direct zichtbaar bij eigenaar (incl. maker en prijsmomentopname)');
  const { data: d2 } = await tsn.from('appointments').select('id').eq('id', apptId);
  assert.equal(d2.length, 1);
  ok('afspraak ook zichtbaar bij TintserviceNL');
}
{
  const moved = await rpc(tsn, 'save_appointment', { p: payload({ id: apptId, expected_version: 1, starts_at: '2026-11-16T12:00:00Z' }) });
  assert.equal(moved.appointment.version, 2);
  const { data } = await owner.from('appointments').select('starts_at, updated_by_name').eq('id', apptId).single();
  assert.equal(new Date(data.starts_at).toISOString(), '2026-11-16T12:00:00.000Z');
  assert.equal(data.updated_by_name, 'TintserviceNL');
  ok('verplaatsen door TintserviceNL zichtbaar bij eigenaar');
}
{
  const err = await pro.rpc('save_appointment', { p: payload({ id: apptId, expected_version: 1, starts_at: '2026-11-16T13:00:00Z' }) });
  assert.ok(err.error);
  const f = toFriendlyError(err.error);
  assert.equal(f.kind, 'conflict');
  assert.match(f.message, /TintserviceNL heeft/);
  ok('gelijktijdige wijziging met oude versie: niet stil overschreven, duidelijke melding');
}
{
  const err = await owner.rpc('save_appointment', { p: payload({ starts_at: '2026-11-16T12:30:00Z' }) });
  const f = toFriendlyError(err.error);
  assert.equal(f.kind, 'rules');
  assert.match(f.message, /Capaciteit vol/);
  ok('overlappende boeking via API geweigerd met begrijpelijke melding');
}
{
  // Gelijktijdig boeken door twee accounts op exact hetzelfde vrije tijdslot
  const p1 = payload({ starts_at: '2026-11-17T14:00:00Z', duration_min: 60 });
  const p2 = payload({ starts_at: '2026-11-17T14:00:00Z', duration_min: 60 });
  const res = await Promise.all([pro.rpc('save_appointment', { p: p1 }), tsn.rpc('save_appointment', { p: p2 }), owner.rpc('save_appointment', { p: payload({ starts_at: '2026-11-17T14:15:00Z', duration_min: 60 }) })]);
  const okCount = res.filter((r) => !r.error).length;
  assert.equal(okCount, 1, JSON.stringify(res.map((r) => r.error?.hint ?? 'ok')));
  ok('gelijktijdig boeken door drie accounts: precies één geaccepteerd');
}
{
  const p = payload({ starts_at: '2026-11-18T14:00:00Z', duration_min: 60 });
  const [a, b] = await Promise.all([pro.rpc('save_appointment', { p }), pro.rpc('save_appointment', { p })]);
  assert.ifError(a.error);
  assert.ifError(b.error);
  assert.equal(a.data.appointment.id, b.data.appointment.id);
  ok('dubbel tikken op opslaan (zelfde verzoek tweemaal) levert één afspraak op');
}
{
  const st = await rpc(owner, 'set_appointment_status', { p_id: apptId, p_status: 'geannuleerd', p_expected_version: 2, p_reason: 'Klant ziek' });
  assert.equal(st.status, 'geannuleerd');
  const { data: ev } = await pro.from('appointment_events').select('action, actor_name').eq('appointment_id', apptId).order('id');
  assert.deepEqual(ev.map((e) => e.action), ['aangemaakt', 'verplaatst', 'geannuleerd']);
  ok('annuleren bewaart afspraak; historie: aangemaakt → verplaatst → geannuleerd');
}

// ---------------------------------------------------------------------------
// 5. Wachtwoord vergeten (herstelcode)
// ---------------------------------------------------------------------------
{
  const since = mails().length;
  assert.ifError((await client().auth.resetPasswordForEmail('tsn@e2e.test')).error);
  const { code, mail } = await waitForCode('tsn@e2e.test', since);
  assert.match(mail.body, /Wachtwoord vergeten/);
  const c = client();
  assert.ifError((await c.auth.verifyOtp({ email: 'tsn@e2e.test', token: code, type: 'recovery' })).error);
  assert.ifError((await c.auth.updateUser({ password: 'HersteldWachtwoord456' })).error);
  assert.ok((await client().auth.signInWithPassword({ email: 'tsn@e2e.test', password: PW })).error);
  assert.ifError((await client().auth.signInWithPassword({ email: 'tsn@e2e.test', password: 'HersteldWachtwoord456' })).error);
  ok('wachtwoord vergeten: code per mail → nieuw wachtwoord werkt, oude niet meer');
}
{
  const since = mails().length;
  const { error } = await owner.functions.invoke('admin-users', { body: { action: 'send_password_reset', user_id: sql(`select id from public.profiles where email='tsn@e2e.test'`) } });
  assert.ifError(error);
  await waitForCode('tsn@e2e.test', since);
  ok('eigenaar kan een wachtwoordherstel-mail voor een collega starten (zonder wachtwoord te zien)');
}
await expectError(() => client().auth.verifyOtp({ email: 'tsn@e2e.test', token: '000000', type: 'recovery' }), /expired|invalid/i, 'ongeldige herstelcode geweigerd');

// ---------------------------------------------------------------------------
// 6. Eigen wachtwoord wijzigen (her-authenticatie)
// ---------------------------------------------------------------------------
{
  const c = client();
  assert.ifError((await c.auth.signInWithPassword({ email: 'pro@e2e.test', password: PW })).error);
  assert.ifError((await c.auth.updateUser({ password: 'NieuwWachtwoord789' })).error);
  assert.ifError((await client().auth.signInWithPassword({ email: 'pro@e2e.test', password: 'NieuwWachtwoord789' })).error);
  ok('eigen wachtwoord wijzigen na recente verificatie met huidig wachtwoord');
  // Met bevestigingscode (nonce), zoals de app doet als de server dat eist
  const since = mails().length;
  assert.ifError((await c.auth.reauthenticate()).error);
  const { code } = await waitForCode('pro@e2e.test', since);
  assert.ifError((await c.auth.updateUser({ password: 'NogEenWachtwoord321', nonce: code })).error);
  ok('eigen wachtwoord wijzigen met bevestigingscode (reauthenticate)');
  await expectError(() => c.auth.updateUser({ password: 'kort1' }), /least|characters|weak/i, 'te kort wachtwoord geweigerd door server');
}

// ---------------------------------------------------------------------------
// 7. Eigen e-mailadres wijzigen: pas actief na bevestiging
// ---------------------------------------------------------------------------
{
  const c = client();
  assert.ifError((await c.auth.signInWithPassword({ email: 'pro@e2e.test', password: 'NogEenWachtwoord321' })).error);
  const since = mails().length;
  const up = await c.auth.updateUser({ email: 'pro-nieuw@e2e.test' });
  assert.ifError(up.error);
  assert.equal(up.data.user.email, 'pro@e2e.test');
  assert.equal(up.data.user.new_email, 'pro-nieuw@e2e.test');
  assert.ifError((await client().auth.signInWithPassword({ email: 'pro@e2e.test', password: 'NogEenWachtwoord321' })).error);
  assert.ok((await client().auth.signInWithPassword({ email: 'pro-nieuw@e2e.test', password: 'NogEenWachtwoord321' })).error);
  ok('nieuw e-mailadres nog niet actief vóór bevestiging (oud adres blijft werken)');
  const newMail = await waitForCode('pro-nieuw@e2e.test', since);
  const oldMail = await waitForCode('pro@e2e.test', since, /e-mailadres|Bevestig/i);
  assert.ifError((await c.auth.verifyOtp({ email: 'pro@e2e.test', token: oldMail.code, type: 'email_change' })).error);
  const v2 = await c.auth.verifyOtp({ email: 'pro-nieuw@e2e.test', token: newMail.code, type: 'email_change' });
  assert.ifError(v2.error);
  const { data: u } = await c.auth.getUser();
  assert.equal(u.user.email, 'pro-nieuw@e2e.test');
  assert.equal(sql(`select email from public.profiles where id='${u.user.id}'`), 'pro-nieuw@e2e.test');
  assert.ifError((await client().auth.signInWithPassword({ email: 'pro-nieuw@e2e.test', password: 'NogEenWachtwoord321' })).error);
  assert.ok((await client().auth.signInWithPassword({ email: 'pro@e2e.test', password: 'NogEenWachtwoord321' })).error);
  ok('e-mailadres gewijzigd na bevestiging van oud én nieuw adres; profiel bijgewerkt');
}

// ---------------------------------------------------------------------------
// 8. Uitloggen op andere apparaten
// ---------------------------------------------------------------------------
{
  const a = client();
  const b = client();
  assert.ifError((await a.auth.signInWithPassword({ email: 'pro-nieuw@e2e.test', password: 'NogEenWachtwoord321' })).error);
  assert.ifError((await b.auth.signInWithPassword({ email: 'pro-nieuw@e2e.test', password: 'NogEenWachtwoord321' })).error);
  const bRefresh = (await b.auth.getSession()).data.session.refresh_token;
  const aRefresh = (await a.auth.getSession()).data.session.refresh_token;
  assert.ifError((await a.auth.signOut({ scope: 'others' })).error);
  assert.ok((await client().auth.refreshSession({ refresh_token: bRefresh })).error, 'andere sessie moet zijn beëindigd');
  assert.ifError((await client().auth.refreshSession({ refresh_token: aRefresh })).error);
  ok('uitloggen op andere apparaten: andere sessie beëindigd, huidige blijft');
}

// ---------------------------------------------------------------------------
// 9. Account uitschakelen: toegang direct weg, ook met nog geldige sessie
// ---------------------------------------------------------------------------
{
  const victim = client();
  assert.ifError((await victim.auth.signInWithPassword({ email: 'tsn@e2e.test', password: 'HersteldWachtwoord456' })).error);
  const refresh = (await victim.auth.getSession()).data.session.refresh_token;
  const uid = sql(`select id from public.profiles where email='tsn@e2e.test'`);
  const { error } = await owner.functions.invoke('admin-users', { body: { action: 'set_active', user_id: uid, active: false } });
  assert.ifError(error);
  const { data: seen } = await victim.from('appointments').select('id');
  assert.equal(seen.length, 0);
  await expectError(() => victim.rpc('save_appointment', { p: payload({ starts_at: '2026-11-20T14:00:00Z' }) }), /Geen toegang/, 'uitgeschakeld: kan niet meer boeken met bestaande sessie');
  ok('uitgeschakeld: bestaande sessie ziet direct geen afspraken meer');
  assert.ok((await client().auth.refreshSession({ refresh_token: refresh })).error);
  ok('uitgeschakeld: sessie kan niet meer vernieuwd worden');
  await expectError(() => client().auth.signInWithPassword({ email: 'tsn@e2e.test', password: 'HersteldWachtwoord456' }), /banned/i, 'uitgeschakeld: opnieuw inloggen geweigerd');
  const ownerId = (await owner.auth.getUser()).data.user.id;
  await expectError(() => owner.functions.invoke('admin-users', { body: { action: 'set_active', user_id: ownerId, active: false } }), /non-2xx|400/, 'eigenaar kan zichzelf niet uitschakelen');
  assert.ifError((await owner.functions.invoke('admin-users', { body: { action: 'set_active', user_id: uid, active: true } })).error);
  const again = client();
  assert.ifError((await again.auth.signInWithPassword({ email: 'tsn@e2e.test', password: 'HersteldWachtwoord456' })).error);
  const { data: seen2 } = await again.from('appointments').select('id');
  assert.ok(seen2.length > 0);
  ok('heractiveren: kan weer inloggen en ziet de planning');
}
{
  const { data } = await owner.functions.invoke('admin-users', { body: { action: 'list' } });
  assert.equal(data.members.length, 3);
  assert.ok(data.members.every((m) => !('password' in m) && !('encrypted_password' in m)));
  ok('teamoverzicht voor eigenaar bevat geen wachtwoorden');
}

// ---------------------------------------------------------------------------
// 10. Netwerkproblemen
// ---------------------------------------------------------------------------
{
  const dead = createClient('http://127.0.0.1:9', ANON, { auth: { persistSession: false } });
  let r;
  try {
    r = await dead.rpc('save_appointment', { p: payload() });
  } catch (e) {
    r = { error: e };
  }
  const f = toFriendlyError(r.error);
  assert.equal(f.kind, 'network');
  assert.match(f.message, /niets opgeslagen/);
  ok('geen verbinding: opslaan faalt met melding "er is niets opgeslagen"');
}


// ---------------------------------------------------------------------------
// 11. Accounts aanmaken met script + inloggen met gebruikersnaam
// ---------------------------------------------------------------------------
{
  const run = (pw) =>
    execFileSync('node', [path.join(appRoot, 'scripts/accounts-aanmaken.mjs')], {
      env: {
        ...process.env,
        SUPABASE_URL: URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE,
        SUPABASE_ANON_KEY: ANON,
        ACCOUNT_BLINDEERREUS_EMAIL: 'baas@e2e.test',
        ACCOUNT_BLINDEERREUS_PASSWORD: pw[0],
        ACCOUNT_PROTINTMASTER_EMAIL: 'khalid@e2e.test',
        ACCOUNT_PROTINTMASTER_PASSWORD: pw[1],
        ACCOUNT_TINTSERVICENL_EMAIL: 'damien@e2e.test',
        ACCOUNT_TINTSERVICENL_PASSWORD: pw[2],
      },
    }).toString();
  const out = run(['Proef-Baas-2026a', 'Proef-Pro-2026a', 'Proef-Tsn-2026a']);
  assert.match(out, /inloggen met "BlindeerReus" gecontroleerd/);
  assert.match(out, /inloggen met "ProTintMaster" gecontroleerd/);
  assert.match(out, /inloggen met "TintserviceNL" gecontroleerd/);
  ok('accountscript maakt drie accounts aan en controleert het inloggen');
  const rows = sql(`select username || ':' || role || ':' || coalesce((select name from public.teams t where t.id = team_id), '-') || ':' || display_name from public.profiles where username is not null order by username`);
  assert.equal(rows, 'BlindeerReus:owner:Blindeer & Go:BlindeerReus\nProTintMaster:colleague:Pro TintMaster:Pro TintMaster\nTintserviceNL:colleague:TintserviceNL:TintserviceNL');
  ok('rollen, partijen en namen goed ingesteld (BlindeerReus = eigenaar)');

  async function loginWithUsername(username, password) {
    const c = client();
    const { data: email, error } = await c.rpc('login_email_for', { p_login: username });
    if (error) throw error;
    const r = await c.auth.signInWithPassword({ email: email ?? '', password });
    return { c, error: r.error };
  }
  for (const [u, pw] of [['blindeerreus', 'Proef-Baas-2026a'], ['PROTINTMASTER', 'Proef-Pro-2026a'], ['Tintservicenl', 'Proef-Tsn-2026a']]) {
    const { error } = await loginWithUsername(u, pw);
    assert.ifError(error);
  }
  ok('inloggen met gebruikersnaam werkt, hoofdletters maken niet uit');
  assert.ok((await loginWithUsername('ProTintMaster', 'fout-wachtwoord1')).error);
  ok('gebruikersnaam met fout wachtwoord geweigerd');

  // Script nogmaals draaien = wachtwoord bijwerken, geen dubbele accounts
  run(['Proef-Baas-2026b', 'Proef-Pro-2026a', 'Proef-Tsn-2026a']);
  assert.equal(sql(`select count(*) from public.profiles where username is not null`), '3');
  assert.ifError((await loginWithUsername('BlindeerReus', 'Proef-Baas-2026b')).error);
  assert.ok((await loginWithUsername('BlindeerReus', 'Proef-Baas-2026a')).error);
  ok('script opnieuw draaien werkt het wachtwoord bij zonder dubbele accounts');

  // Uitnodigen met gebruikersnaam via teambeheer
  const { c: baas } = await loginWithUsername('BlindeerReus', 'Proef-Baas-2026b');
  const since = mails().length;
  const inv = await baas.functions.invoke('admin-users', { body: { action: 'invite', email: 'nieuw@e2e.test', display_name: 'Nieuwe collega', username: 'NieuweCollega', role: 'colleague' } });
  assert.ifError(inv.error);
  const { code } = await waitForCode('nieuw@e2e.test', since);
  const nc = client();
  assert.ifError((await nc.auth.verifyOtp({ email: 'nieuw@e2e.test', token: code, type: 'invite' })).error);
  assert.ifError((await nc.auth.updateUser({ password: 'Collega12345' })).error);
  assert.ifError((await loginWithUsername('nieuwecollega', 'Collega12345')).error);
  ok('uitnodiging met gebruikersnaam: daarna inloggen met die gebruikersnaam');
  await expectError(
    () => baas.functions.invoke('admin-users', { body: { action: 'invite', email: 'ander@e2e.test', display_name: 'X', username: 'protintmaster', role: 'colleague' } }),
    /non-2xx|409/,
    'uitnodiging met bestaande gebruikersnaam geweigerd',
  );

  // Overzicht via de API
  const st = await rpc(baas, 'appointment_stats', { p_from: null, p_to: null, p_bucket: 'month' });
  assert.equal(st.planned, Number(sql(`select count(*) from public.appointments where status in ('ingepland','bezig','afgerond')`)));
  ok('overzicht (alle tijd) via de API klopt met de database');
}

console.log(`\nE2E: ${passed} controles geslaagd`);
