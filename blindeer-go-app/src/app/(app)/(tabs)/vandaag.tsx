import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { AppointmentCard } from '../../../components/planning';
import { Button, Card, Empty, ErrorState, Loading, Screen, Section, T, useAccent } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useAppointmentsRange, useTeams } from '../../../lib/queries';
import { addDays, formatDateLong, formatTime, todayIsoDate } from '../../../lib/time';
import { dismissHint, hintDismissed, isStandalone, isWeb } from '../../../lib/pwa';
import { periodRange, useStats } from '../../../lib/stats';
import { colors, radius, space } from '../../../theme';

export default function Today() {
  const { profile } = useAuth();
  const [today, setToday] = useState(todayIsoDate());
  const [now, setNow] = useState(Date.now());
  // Elke minuut bijwerken (eerstvolgende afspraak, datumwissel om middernacht).
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setToday(todayIsoDate());
    }, 60_000);
    return () => clearInterval(t);
  }, []);

  const appts = useAppointmentsRange(today, addDays(today, 1));
  const accent = useAccent();
  const week = useStats(useMemo(() => periodRange('week', today), [today]), 'alle');
  const month = useStats(useMemo(() => periodRange('maand', today), [today]), 'alle');
  const [showHint, setShowHint] = useState(() => isWeb && !isStandalone() && !hintDismissed());
  const teams = useTeams();
  const teamById = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);

  const list = appts.data ?? [];
  const active = list.filter((a) => a.status !== 'geannuleerd' && a.status !== 'niet_verschenen');
  const next = active.find((a) => new Date(a.ends_at).getTime() > now && a.status !== 'afgerond');
  const running = active.filter((a) => a.status === 'bezig');

  return (
    <Screen onRefresh={() => appts.refetch()} refreshing={appts.isRefetching}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.md }}>
        <Image source={require('../../../../assets/logo-round.png')} style={{ width: 56, height: 56 }} accessibilityLabel="Blindeer & Go" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <T.Muted>Hallo {profile?.display_name}</T.Muted>
          <T.H1 style={{ fontSize: 24 }}>{formatDateLong(today)}</T.H1>
        </View>
      </View>

      <Button title="Afspraak toevoegen" icon="＋" big onPress={() => router.push({ pathname: '/afspraak/nieuw', params: { date: today } })} />

      <Pressable onPress={() => router.push('/overzicht')} accessibilityRole="button" accessibilityLabel="Naar overzicht" style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        {[
          { label: 'Vandaag', value: appts.data ? String(appts.data.filter((a) => a.status !== 'geannuleerd' && a.status !== 'niet_verschenen').length) : '…' },
          { label: 'Deze week', value: week.data ? String(week.data.planned) : '…' },
          { label: 'Deze maand', value: month.data ? String(month.data.planned) : '…' },
        ].map((x) => (
          <View key={x.label} style={{ flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md }}>
            <Text style={{ color: colors.text, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{x.value}</Text>
            <Text style={{ color: colors.textDim, fontSize: 13 }}>{x.label}</Text>
          </View>
        ))}
      </Pressable>

      {showHint ? (
        <Card style={{ marginTop: space.md, borderColor: accent }}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>Tip: zet de planning op je beginscherm</Text>
          <T.Muted style={{ marginTop: 2 }}>Dan opent hij als een app, schermvullend en met een eigen icoon.</T.Muted>
          <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
            <Button title="Laat zien hoe" onPress={() => router.push('/installeren')} style={{ flex: 1 }} />
            <Button title="Niet nu" variant="secondary" onPress={() => { dismissHint(); setShowHint(false); }} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : null}

      {appts.isLoading ? (
        <Loading />
      ) : appts.error ? (
        <ErrorState error={appts.error} onRetry={() => appts.refetch()} />
      ) : (
        <>
          <Section title={running.length ? 'Nu bezig' : 'Eerstvolgende afspraak'}>
            {running.length ? (
              running.map((a) => (
                <AppointmentCard key={a.id} a={a} team={teamById.get(a.team_id ?? '')} onPress={() => router.push(`/afspraak/${a.id}`)} />
              ))
            ) : next ? (
              <>
                <T.Muted style={{ marginBottom: space.sm }}>
                  {new Date(next.starts_at).getTime() > now
                    ? `Begint om ${formatTime(next.starts_at)} (over ${Math.max(0, Math.round((new Date(next.starts_at).getTime() - now) / 60000))} min)`
                    : 'Loopt nu'}
                </T.Muted>
                <AppointmentCard a={next} team={teamById.get(next.team_id ?? '')} onPress={() => router.push(`/afspraak/${next.id}`)} />
              </>
            ) : (
              <Card>
                <T.Muted>Geen komende afspraken meer vandaag.</T.Muted>
              </Card>
            )}
          </Section>

          <Section title={`Vandaag (${active.length})`}>
            {list.length === 0 ? (
              <Empty title="Nog geen afspraken" text="Er staat vandaag niets gepland." />
            ) : (
              <View>
                {list.map((a) => (
                  <AppointmentCard key={a.id} a={a} team={teamById.get(a.team_id ?? '')} onPress={() => router.push(`/afspraak/${a.id}`)} />
                ))}
              </View>
            )}
          </Section>
        </>
      )}
    </Screen>
  );
}
