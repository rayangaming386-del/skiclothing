// Edge Function: teambeheer door de eigenaar.
// Draait op de server van Supabase; de service-role-sleutel staat alleen hier (als secret), nooit in de app.
//
// Acties (POST JSON { action, ... }):
//   list                                  → teamleden met accountstatus
//   invite { email, display_name, username?, role, team_id? }
//   set_active { user_id, active }        → (de)activeren, incl. blokkeren van inloggen/vernieuwen
//   send_password_reset { user_id }       → stuurt herstelmail met code
//   resend_invite { user_id }             → nieuwe uitnodiging voor nog niet geactiveerd account
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// Optioneel: link in e-mails (bv. blindeergo://auth). De app werkt ook met alleen de code.
const REDIRECT_URL = Deno.env.get('AUTH_REDIRECT_URL') ?? undefined;

const BAN_FOREVER = '876000h'; // ±100 jaar

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'Alleen POST' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new HttpError(401, 'Niet ingelogd');

    // Wie roept aan? Token controleren via Supabase Auth.
    const caller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    if (userErr || !userData.user) throw new HttpError(401, 'Sessie ongeldig');

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data: me } = await admin.from('profiles').select('id, role, active').eq('id', userData.user.id).single();
    if (!me || !me.active || me.role !== 'owner') throw new HttpError(403, 'Alleen de eigenaar mag teamleden beheren');

    const body = await req.json().catch(() => ({}));
    switch (body.action) {
      case 'list':
        return json(await listMembers(admin));
      case 'invite':
        return json(await invite(admin, body));
      case 'set_active':
        return json(await setActive(admin, me.id, body));
      case 'send_password_reset':
        return json(await sendPasswordReset(admin, body));
      case 'resend_invite':
        return json(await resendInvite(admin, body));
      default:
        throw new HttpError(400, 'Onbekende actie');
    }
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    const message = e instanceof Error ? e.message : 'Onbekende fout';
    if (status === 500) console.error(e);
    return json({ error: message }, status);
  }
});

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, any, any>;

async function listMembers(admin: Admin) {
  const { data: profiles, error } = await admin
    .from('profiles')
    .select('id, email, username, display_name, phone, role, team_id, active, created_at')
    .order('created_at');
  if (error) throw error;
  const { data: users, error: usersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (usersErr) throw usersErr;
  const byId = new Map(users.users.map((u) => [u.id, u]));
  return {
    members: profiles.map((p) => {
      const u = byId.get(p.id);
      return {
        ...p,
        email: u?.email ?? p.email,
        invited_at: u?.invited_at ?? null,
        email_confirmed_at: u?.email_confirmed_at ?? null,
        last_sign_in_at: u?.last_sign_in_at ?? null,
        pending_email: u?.new_email ?? null,
      };
    }),
  };
}

async function invite(admin: Admin, body: Record<string, unknown>) {
  const email = String(body.email ?? '').trim().toLowerCase();
  const displayName = String(body.display_name ?? '').trim();
  const role = body.role === 'owner' ? 'owner' : 'colleague';
  const teamId = typeof body.team_id === 'string' && body.team_id ? body.team_id : null;
  const username = String(body.username ?? '').trim() || null;
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Ongeldig e-mailadres');
  if (!displayName) throw new HttpError(400, 'Vul een naam in');
  if (username) {
    if (!USERNAME_RE.test(username)) throw new HttpError(400, 'Gebruikersnaam: 3–32 tekens, alleen letters, cijfers, punt, streepje of underscore');
    const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).ilike('username', username.replace(/[\\%_]/g, '\\$&'));
    if (count) throw new HttpError(409, 'Deze gebruikersnaam is al in gebruik');
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { display_name: displayName },
    redirectTo: REDIRECT_URL,
  });
  if (error) {
    if (/already been registered|already exists/i.test(error.message)) {
      throw new HttpError(409, 'Er bestaat al een account met dit e-mailadres');
    }
    throw error;
  }
  const userId = data.user.id;
  // Rol en partij server-side vastleggen (app_metadata kan een gebruiker zelf niet wijzigen).
  await admin.auth.admin.updateUserById(userId, { app_metadata: { role, team_id: teamId, username } });
  const { error: profErr } = await admin
    .from('profiles')
    .update({ role, team_id: teamId, display_name: displayName, username })
    .eq('id', userId);
  if (profErr) throw profErr;
  return { user_id: userId };
}

async function setActive(admin: Admin, callerId: string, body: Record<string, unknown>) {
  const userId = String(body.user_id ?? '');
  const active = body.active === true;
  if (!userId) throw new HttpError(400, 'user_id ontbreekt');
  if (!active && userId === callerId) throw new HttpError(400, 'Je kunt je eigen account niet uitschakelen');

  const { data: target } = await admin.from('profiles').select('id, role, active').eq('id', userId).single();
  if (!target) throw new HttpError(404, 'Teamlid niet gevonden');
  if (!active && target.role === 'owner') {
    const { count } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'owner')
      .eq('active', true)
      .neq('id', userId);
    if (!count) throw new HttpError(400, 'Er moet minimaal één actieve eigenaar blijven');
  }

  // 1) Profiel inactief → database weigert direct alle verzoeken (RLS), ook met een nog geldige sessie.
  const { error } = await admin.from('profiles').update({ active }).eq('id', userId);
  if (error) throw error;
  // 2) Inloggen en sessie vernieuwen blokkeren.
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: active ? 'none' : BAN_FOREVER,
  });
  if (banErr) throw banErr;
  return { user_id: userId, active };
}

async function emailOf(admin: Admin, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user?.email) throw new HttpError(404, 'Account niet gevonden');
  return data.user;
}

async function sendPasswordReset(admin: Admin, body: Record<string, unknown>) {
  const user = await emailOf(admin, String(body.user_id ?? ''));
  // Gebruik de publieke flow zodat de gewone herstelmail (met code) wordt verstuurd.
  const pub = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });
  const { error } = await pub.auth.resetPasswordForEmail(user.email!, { redirectTo: REDIRECT_URL });
  if (error) throw error;
  return { sent_to: user.email };
}

async function resendInvite(admin: Admin, body: Record<string, unknown>) {
  const user = await emailOf(admin, String(body.user_id ?? ''));
  if (user.last_sign_in_at) throw new HttpError(400, 'Dit account is al in gebruik; stuur een wachtwoordherstel');
  const { error } = await admin.auth.admin.inviteUserByEmail(user.email!, {
    data: user.user_metadata,
    redirectTo: REDIRECT_URL,
  });
  if (error) throw error;
  return { sent_to: user.email };
}
