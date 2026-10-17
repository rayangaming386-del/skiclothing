import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { AppointmentCard } from '../../../components/planning';
import { Button, Card, Empty, ErrorState, Loading, Screen, Section, T } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { useAppointmentsRange, useTeams } from '../../../lib/queries';
import { addDays, formatDateLong, formatTime, todayIsoDate } from '../../../lib/time';
import { space } from '../../../theme';

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
  const teams = useTeams();
  const teamById = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);

  const list = appts.data ?? [];
  const active = list.filter((a) => a.status !== 'geannuleerd' && a.status !== 'niet_verschenen');
  const next = active.find((a) => new Date(a.ends_at).getTime() > now && a.status !== 'afgerond');
  const running = active.filter((a) => a.status === 'bezig');

  return (
    <Screen onRefresh={() => appts.refetch()} refreshing={appts.isRefetching}>
      <T.Muted>Hallo {profile?.display_name}</T.Muted>
      <T.H1 style={{ marginBottom: space.md }}>{formatDateLong(today)}</T.H1>

      <Button title="Afspraak toevoegen" icon="＋" big onPress={() => router.push({ pathname: '/afspraak/nieuw', params: { date: today } })} />

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
