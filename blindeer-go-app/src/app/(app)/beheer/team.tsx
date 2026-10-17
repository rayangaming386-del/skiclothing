import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { TeamBadge } from '../../../components/planning';
import { Button, Card, Chip, ChipRow, Empty, ErrorState, Field, Loading, Notice, Screen, Section, T, useToast } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { toFriendlyError } from '../../../lib/errors';
import { qk, useTeams } from '../../../lib/queries';
import { supabase } from '../../../lib/supabase';
import { formatDateTime } from '../../../lib/time';
import { Role } from '../../../lib/types';
import { isEmail } from '../../../lib/validation';
import { colors, space } from '../../../theme';

interface Member {
  id: string;
  email: string | null;
  display_name: string;
  role: Role;
  team_id: string | null;
  active: boolean;
  invited_at?: string | null;
  email_confirmed_at?: string | null;
  last_sign_in_at?: string | null;
  pending_email?: string | null;
}

async function adminCall<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    // Probeer de foutmelding van de functie te tonen.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      const j = await ctx.json().catch(() => null);
      if (j?.error) throw new Error(j.error);
    }
    throw error;
  }
  return data as T;
}

export default function TeamAdmin() {
  const { isOwner, profile } = useAuth();
  const teams = useTeams();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const members = useQuery({
    queryKey: ['admin', 'members'],
    enabled: isOwner,
    queryFn: async () => {
      try {
        return { members: (await adminCall<{ members: Member[] }>({ action: 'list' })).members, viaFunction: true };
      } catch {
        // Edge Function nog niet uitgerold: toon in ieder geval de profielen.
        const { data, error } = await supabase.from('profiles').select('*').order('display_name');
        if (error) throw error;
        return { members: data as Member[], viaFunction: false };
      }
    },
  });

  if (!isOwner) return <Empty title="Geen toegang" text="Alleen de eigenaar beheert gebruikers en rechten." />;
  if (members.isLoading) return <Loading />;
  if (members.error) return <ErrorState error={members.error} onRetry={() => members.refetch()} />;

  const refresh = () => {
    members.refetch();
    qc.invalidateQueries({ queryKey: qk.profiles });
  };

  const run = async (id: string, fn: () => Promise<unknown>, okMsg: string) => {
    setBusyId(id);
    try {
      await fn();
      toast(okMsg);
      refresh();
    } catch (e) {
      const f = toFriendlyError(e);
      Alert.alert(f.title, f.message);
    } finally {
      setBusyId(null);
    }
  };

  const updateMember = (m: Member, patch: { p_role?: Role; p_team_id?: string; p_clear_team?: boolean }) =>
    run(
      m.id,
      async () => {
        const { error } = await supabase.rpc('admin_update_member', { p_user_id: m.id, ...patch });
        if (error) throw error;
      },
      'Opgeslagen',
    );

  const setActive = (m: Member, active: boolean) =>
    Alert.alert(
      active ? 'Account activeren?' : 'Account uitschakelen?',
      active ? `${m.display_name} krijgt weer toegang.` : `${m.display_name} verliest direct alle toegang, ook op apparaten waar al is ingelogd. Afspraken en historie blijven bewaard.`,
      [
        { text: 'Annuleren', style: 'cancel' },
        {
          text: active ? 'Activeren' : 'Uitschakelen',
          style: active ? 'default' : 'destructive',
          onPress: () => run(m.id, () => adminCall({ action: 'set_active', user_id: m.id, active }), active ? 'Account geactiveerd' : 'Account uitgeschakeld'),
        },
      ],
    );

  const viaFunction = members.data?.viaFunction;

  return (
    <Screen onRefresh={refresh} refreshing={members.isRefetching}>
      {!viaFunction ? (
        <Notice kind="warning">
          De beheerfunctie "admin-users" is nog niet bereikbaar. Uitnodigen, uitschakelen en herstelmails werken pas na het uitrollen (zie docs/SETUP.md).
        </Notice>
      ) : null}
      <Notice>Wachtwoorden van collega’s zijn nooit zichtbaar. Je kunt wel een herstelmail laten sturen.</Notice>
      <Button title="Collega uitnodigen" icon="＋" onPress={() => setInviteOpen(!inviteOpen)} variant={inviteOpen ? 'secondary' : 'primary'} />
      {inviteOpen ? <InviteForm onDone={() => { setInviteOpen(false); refresh(); }} /> : null}

      <Section title={`Teamleden (${members.data?.members.length ?? 0})`}>
        {(members.data?.members ?? []).map((m) => {
          const isMe = m.id === profile?.id;
          const pendingInvite = viaFunction && !m.last_sign_in_at;
          return (
            <Card key={m.id} style={!m.active ? { opacity: 0.6 } : undefined}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', flex: 1 }}>
                  {m.display_name}
                  {isMe ? ' (jij)' : ''}
                </Text>
                <Text style={{ color: m.active ? colors.success : colors.danger, fontWeight: '700' }}>{m.active ? 'Actief' : 'Uitgeschakeld'}</Text>
              </View>
              <T.Muted>{m.email}</T.Muted>
              {m.pending_email ? <T.Muted>Nieuw adres wacht op bevestiging: {m.pending_email}</T.Muted> : null}
              {viaFunction ? (
                <T.Muted style={{ fontSize: 13 }}>
                  {m.last_sign_in_at ? `Laatst ingelogd ${formatDateTime(m.last_sign_in_at)}` : m.invited_at ? `Uitgenodigd ${formatDateTime(m.invited_at)} — nog niet geactiveerd` : 'Nog nooit ingelogd'}
                </T.Muted>
              ) : null}
              <View style={{ marginTop: space.sm }}>
                <TeamBadge team={teams.data?.find((t) => t.id === m.team_id)} small />
              </View>

              <Text style={{ color: colors.textDim, fontSize: 13, marginTop: space.md, marginBottom: 4 }}>Rol</Text>
              <ChipRow>
                <Chip label="Eigenaar" selected={m.role === 'owner'} onPress={() => m.role !== 'owner' && updateMember(m, { p_role: 'owner' })} disabled={busyId === m.id} />
                <Chip label="Collega" selected={m.role === 'colleague'} onPress={() => m.role !== 'colleague' && updateMember(m, { p_role: 'colleague' })} disabled={busyId === m.id} />
              </ChipRow>
              <Text style={{ color: colors.textDim, fontSize: 13, marginTop: space.sm, marginBottom: 4 }}>Uitvoerende partij</Text>
              <ChipRow scroll>
                <Chip label="Geen" selected={!m.team_id} onPress={() => m.team_id && updateMember(m, { p_clear_team: true })} />
                {(teams.data ?? []).filter((t) => t.active).map((t) => (
                  <Chip key={t.id} label={t.name} color={t.color} selected={m.team_id === t.id} onPress={() => m.team_id !== t.id && updateMember(m, { p_team_id: t.id })} />
                ))}
              </ChipRow>

              {viaFunction && !isMe ? (
                <View style={{ gap: space.sm, marginTop: space.md }}>
                  {pendingInvite ? (
                    <Button title="Uitnodiging opnieuw sturen" variant="secondary" onPress={() => run(m.id, () => adminCall({ action: 'resend_invite', user_id: m.id }), 'Uitnodiging verstuurd')} loading={busyId === m.id} />
                  ) : (
                    <Button title="Wachtwoordherstel sturen" variant="secondary" onPress={() => run(m.id, () => adminCall({ action: 'send_password_reset', user_id: m.id }), 'Herstelmail verstuurd')} loading={busyId === m.id} />
                  )}
                  <Button title={m.active ? 'Account uitschakelen' : 'Account activeren'} variant={m.active ? 'danger' : 'primary'} onPress={() => setActive(m, !m.active)} disabled={busyId === m.id} />
                </View>
              ) : null}
            </Card>
          );
        })}
      </Section>
    </Screen>
  );
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const teams = useTeams();
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('colleague');
  const [teamId, setTeamId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!isEmail(email)) return setError('Vul een geldig e-mailadres in.');
    if (!name.trim()) return setError('Vul een naam in.');
    setBusy(true);
    setError(null);
    try {
      await adminCall({ action: 'invite', email: email.trim().toLowerCase(), display_name: name.trim(), role, team_id: teamId });
      toast(`Uitnodiging verstuurd naar ${email.trim()}`);
      onDone();
    } catch (e) {
      setError(toFriendlyError(e).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={{ marginTop: space.md }}>
      <Field label="E-mailadres" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Weergavenaam" value={name} onChangeText={setName} placeholder="bv. Pro TintMaster" />
      <Text style={{ color: colors.textDim, fontSize: 13, marginBottom: 4 }}>Rol</Text>
      <ChipRow>
        <Chip label="Collega" selected={role === 'colleague'} onPress={() => setRole('colleague')} />
        <Chip label="Eigenaar" selected={role === 'owner'} onPress={() => setRole('owner')} />
      </ChipRow>
      <Text style={{ color: colors.textDim, fontSize: 13, marginTop: space.md, marginBottom: 4 }}>Uitvoerende partij</Text>
      <ChipRow>
        <Chip label="Geen" selected={!teamId} onPress={() => setTeamId(null)} />
        {(teams.data ?? []).filter((t) => t.active).map((t) => (
          <Chip key={t.id} label={t.name} color={t.color} selected={teamId === t.id} onPress={() => setTeamId(t.id)} />
        ))}
      </ChipRow>
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Uitnodiging versturen" onPress={submit} loading={busy} style={{ marginTop: space.md }} />
      <T.Muted style={{ fontSize: 13, marginTop: space.sm }}>
        De collega ontvangt een e-mail met een code, opent de app en kiest "Uitnodiging ontvangen? Account activeren".
      </T.Muted>
    </Card>
  );
}
