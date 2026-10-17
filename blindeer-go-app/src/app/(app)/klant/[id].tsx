import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { AppointmentCard, callPhone, openWhatsApp } from '../../../components/planning';
import { Button, Card, ErrorState, Loading, Screen, Section, T } from '../../../components/ui';
import { BODY_TYPES } from '../../../lib/pricing';
import { useCustomer, useTeams } from '../../../lib/queries';
import { formatDateShort, isoDateOf } from '../../../lib/time';
import { colors, space } from '../../../theme';

export default function CustomerDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useCustomer(id);
  const teams = useTeams();
  const teamById = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { customer: c, appointments } = q.data;
  const now = Date.now();
  const upcoming = appointments.filter((a) => new Date(a.ends_at).getTime() >= now).reverse();
  const past = appointments.filter((a) => new Date(a.ends_at).getTime() < now);
  const vehicles = c.vehicles.filter((v) => !v.archived_at);

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <T.H1>{c.name}</T.H1>
      <T.Muted>{c.phone ?? 'Geen telefoonnummer'}</T.Muted>
      {c.email ? <T.Muted>{c.email}</T.Muted> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
        <Button title="Bellen" icon="✆" variant="secondary" onPress={() => callPhone(c.phone)} disabled={!c.phone} style={{ flex: 1 }} />
        <Button title="WhatsApp" variant="secondary" onPress={() => openWhatsApp(c.phone, `Beste ${c.name},\n\n`)} disabled={!c.phone} style={{ flex: 1 }} />
      </View>
      <Button title="Nieuwe afspraak voor deze klant" icon="＋" big onPress={() => router.push({ pathname: '/afspraak/nieuw', params: { customerId: c.id } })} style={{ marginTop: space.sm }} />
      <Button title="Klantgegevens bewerken" variant="ghost" onPress={() => router.push({ pathname: '/klant/bewerken', params: { id: c.id } })} style={{ marginTop: space.sm }} />

      {c.notes ? (
        <Section title="Interne opmerkingen">
          <Card>
            <T.Body>{c.notes}</T.Body>
          </Card>
        </Section>
      ) : null}

      <Section title={`Auto's (${vehicles.length})`}>
        {vehicles.map((v) => (
          <Card key={v.id} onPress={() => router.push({ pathname: '/klant/voertuig', params: { customerId: c.id, id: v.id } })}>
            <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>
              {[v.make, v.model, v.variant].filter(Boolean).join(' ') || 'Auto'} {v.build_year ? `(${v.build_year})` : ''}
            </Text>
            <T.Muted>
              {[v.plate?.toUpperCase(), BODY_TYPES.find((b) => b.value === v.body_type)?.label, v.rear_window_count ? `${v.rear_window_count} achterramen` : null]
                .filter(Boolean)
                .join(' · ') || 'Geen details'}
            </T.Muted>
          </Card>
        ))}
        <Button title="Auto toevoegen" variant="secondary" onPress={() => router.push({ pathname: '/klant/voertuig', params: { customerId: c.id } })} />
      </Section>

      <Section title={`Komende afspraken (${upcoming.length})`}>
        {upcoming.length ? (
          upcoming.map((a) => (
            <View key={a.id}>
              <T.Muted style={{ fontSize: 13 }}>{formatDateShort(isoDateOf(a.starts_at))}</T.Muted>
              <AppointmentCard a={a} team={teamById.get(a.team_id ?? '')} compact onPress={() => router.push(`/afspraak/${a.id}`)} />
            </View>
          ))
        ) : (
          <T.Muted>Geen komende afspraken.</T.Muted>
        )}
      </Section>

      <Section title={`Eerdere afspraken (${past.length})`}>
        {past.length ? (
          past.map((a) => (
            <View key={a.id}>
              <T.Muted style={{ fontSize: 13 }}>{formatDateShort(isoDateOf(a.starts_at))}</T.Muted>
              <AppointmentCard a={a} team={teamById.get(a.team_id ?? '')} compact onPress={() => router.push(`/afspraak/${a.id}`)} />
            </View>
          ))
        ) : (
          <T.Muted>Nog geen eerdere afspraken.</T.Muted>
        )}
      </Section>
    </Screen>
  );
}
