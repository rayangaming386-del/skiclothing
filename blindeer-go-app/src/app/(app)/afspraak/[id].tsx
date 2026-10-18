import * as Crypto from 'expo-crypto';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { callPhone, openWhatsApp, StatusBadge, TeamBadge, treatmentsLabel, vehicleLabel } from '../../../components/planning';
import { Button, Card, Chip, ChipRow, ErrorState, Loading, Notice, PromptModal, Row, Screen, Section, T, useToast } from '../../../components/ui';
import { toFriendlyError } from '../../../lib/errors';
import { formatDuration, formatEuro } from '../../../lib/pricing';
import { useAppointment, useAppointmentEvents, useAppointmentPhotos, useProfiles, useSetStatus, useSettings, useTeams, useWorkstations } from '../../../lib/queries';
import { supabase } from '../../../lib/supabase';
import { formatDateLong, formatDateTime, formatTime, isoDateOf } from '../../../lib/time';
import { AppointmentStatus, statusLabel, STATUSES } from '../../../lib/types';
import { colors, space, statusColors } from '../../../theme';
import { Alert } from '../../../components/Dialog';

const ACTION_LABELS: Record<string, string> = {
  aangemaakt: 'Aangemaakt',
  gewijzigd: 'Gewijzigd',
  verplaatst: 'Verplaatst',
  status: 'Status gewijzigd',
  geannuleerd: 'Geannuleerd',
};

export default function AppointmentDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useAppointment(id);
  const events = useAppointmentEvents(id);
  const photos = useAppointmentPhotos(id);
  const teams = useTeams();
  const profiles = useProfiles();
  const workstations = useWorkstations();
  const settings = useSettings();
  const setStatus = useSetStatus();
  const toast = useToast();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const a = q.data;
  const team = useMemo(() => teams.data?.find((t) => t.id === a?.team_id), [teams.data, a?.team_id]);
  const profileName = (pid: string | null) => profiles.data?.find((p) => p.id === pid)?.display_name;

  if (q.isLoading) return <Loading />;
  if (q.error || !a) return <ErrorState error={q.error ?? new Error('Afspraak niet gevonden')} onRetry={() => q.refetch()} />;

  const changeStatus = async (status: AppointmentStatus, reason?: string) => {
    try {
      await setStatus.mutateAsync({ id: a.id, status, version: a.version, reason });
      toast(`Status: ${statusLabel(status)}`);
    } catch (e) {
      const f = toFriendlyError(e);
      Alert.alert(f.title, f.message);
      q.refetch();
    }
  };

  const confirmStatus = (s: AppointmentStatus) => {
    if (s === a.status) return;
    if (s === 'geannuleerd') {
      setCancelOpen(true);
      return;
    }
    Alert.alert('Status wijzigen', `Status wijzigen naar "${statusLabel(s)}"?`, [
      { text: 'Nee', style: 'cancel' },
      { text: 'Ja', onPress: () => changeStatus(s) },
    ]);
  };

  const whatsappDraft = () => {
    const st = settings.data;
    const address = [st?.address_line, [st?.postal_code, st?.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
    return [
      `Beste ${a.customer_name},`,
      '',
      `Hierbij de bevestiging van uw afspraak bij ${st?.company_name ?? 'ons'} op ${formatDateLong(isoDateOf(a.starts_at))} om ${formatTime(a.starts_at)}.`,
      `Behandeling: ${treatmentsLabel(a)}.`,
      address ? `Adres: ${address}.` : null,
      st?.directions ? st.directions : null,
      '',
      'Met vriendelijke groet,',
      st?.company_name ?? '',
    ]
      .filter((x) => x !== null)
      .join('\n');
  };

  const addPhoto = async (camera: boolean) => {
    const perm = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Geen toestemming', 'Geef toegang in de instellingen van je telefoon.');
      return;
    }
    const res = camera
      ? await ImagePicker.launchCameraAsync({ quality: 0.6, mediaTypes: ['images'] })
      : await ImagePicker.launchImageLibraryAsync({ quality: 0.6, mediaTypes: ['images'] });
    if (res.canceled || !res.assets?.[0]) return;
    setUploading(true);
    try {
      const asset = res.assets[0];
      const body = await (await fetch(asset.uri)).arrayBuffer();
      const path = `${a.id}/${Crypto.randomUUID()}.jpg`;
      const up = await supabase.storage.from('appointment-photos').upload(path, body, { contentType: asset.mimeType ?? 'image/jpeg' });
      if (up.error) throw up.error;
      const { data: userData } = await supabase.auth.getUser();
      const ins = await supabase.from('appointment_photos').insert({ appointment_id: a.id, storage_path: path, uploaded_by: userData.user?.id });
      if (ins.error) throw ins.error;
      toast('Foto opgeslagen');
      photos.refetch();
    } catch (e) {
      const f = toFriendlyError(e);
      Alert.alert(f.title, f.message);
    } finally {
      setUploading(false);
    }
  };

  const items = [...(a.appointment_items ?? [])].sort((x, y) => x.position - y.position);
  const creatorNow = profileName(a.created_by);

  return (
    <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <StatusBadge status={a.status} />
        <TeamBadge team={team} />
      </View>
      <T.H1 style={{ marginTop: space.md }}>
        {formatTime(a.starts_at)}–{formatTime(a.ends_at)}
      </T.H1>
      <T.Muted>{formatDateLong(isoDateOf(a.starts_at))}</T.Muted>
      {a.status_reason ? <Notice kind={a.status === 'geannuleerd' ? 'danger' : 'info'}>Reden: {a.status_reason}</Notice> : null}
      {a.rules_overridden ? <Notice kind="warning">Bewust buiten de bedrijfsregels geboekt{a.override_reason ? `: ${a.override_reason}` : ''}.</Notice> : null}

      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
        <Button title="Bewerken" variant="secondary" onPress={() => router.push({ pathname: '/afspraak/nieuw', params: { id: a.id } })} style={{ flex: 1 }} />
        <Button title="Verplaatsen" variant="secondary" onPress={() => router.push({ pathname: '/afspraak/nieuw', params: { id: a.id, stap: 'planning' } })} style={{ flex: 1 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <Button title="Bellen" icon="✆" variant="secondary" onPress={() => callPhone(a.customer_phone)} disabled={!a.customer_phone} style={{ flex: 1 }} />
        <Button title="WhatsApp" variant="secondary" onPress={() => openWhatsApp(a.customer_phone, whatsappDraft())} disabled={!a.customer_phone} style={{ flex: 1 }} />
      </View>
      {a.customer_phone ? <T.Muted style={{ fontSize: 13, marginTop: 4 }}>WhatsApp opent met een conceptbericht; jij verstuurt het zelf.</T.Muted> : null}

      <Section title="Status wijzigen">
        <ChipRow>
          {STATUSES.map((s) => (
            <Chip key={s.value} label={s.label} color={statusColors[s.value]} selected={a.status === s.value} onPress={() => confirmStatus(s.value)} disabled={setStatus.isPending} />
          ))}
        </ChipRow>
      </Section>

      <Section title="Klant en auto">
        <Card onPress={a.customer_id ? () => router.push(`/klant/${a.customer_id}`) : undefined}>
          <T.H2>{a.customer_name}</T.H2>
          <T.Muted>{a.customer_phone ?? 'Geen telefoonnummer'}</T.Muted>
          {a.customer_email ? <T.Muted>{a.customer_email}</T.Muted> : null}
          <T.Body style={{ marginTop: space.sm }}>{vehicleLabel(a.vehicle)}</T.Body>
          <T.Muted>
            {[a.vehicle?.body_type, a.vehicle?.rear_window_count ? `${a.vehicle.rear_window_count} achterramen` : null, a.vehicle?.high_entry == null ? null : a.vehicle.high_entry ? 'hoge instap' : 'gewone instap']
              .filter(Boolean)
              .join(' · ')}
          </T.Muted>
        </Card>
      </Section>

      <Section title="Behandeling en prijs">
        <Card>
          {items.map((i) => (
            <View key={i.id} style={{ marginBottom: space.sm }}>
              <Row
                label={i.service_name}
                value={
                  <Text style={{ color: i.price_overridden ? colors.warning : colors.text }}>
                    {i.bundle_label && i.price_cents === 0 && !i.price_overridden ? 'inbegrepen' : formatEuro(i.price_cents)}
                    {i.price_overridden ? ` (std. ${formatEuro(i.standard_price_cents)})` : ''}
                  </Text>
                }
              />
              <T.Muted style={{ fontSize: 14 }}>
                {[
                  i.film_brand,
                  i.film_percentage != null ? `${i.film_percentage}% folie` : null,
                  i.film_color,
                  i.measured_vlt != null ? `gemeten ${i.measured_vlt}% lichtdoorlaat` : null,
                  i.model_exception_label ? `uitzondering: ${i.model_exception_label}` : null,
                  i.bundle_label ? `pakket: ${i.bundle_label}` : null,
                  i.duration_min != null ? formatDuration(i.duration_min) + (i.duration_overridden ? ' (aangepast)' : '') : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </T.Muted>
              {i.discount_cents ? <T.Muted style={{ color: colors.success, fontSize: 14 }}>Korting {i.discount_label}: − {formatEuro(i.discount_cents)}</T.Muted> : null}
              {i.note ? <T.Muted style={{ fontSize: 14 }}>📝 {i.note}</T.Muted> : null}
            </View>
          ))}
          <Row label="Totaal" value={<Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>{a.price_complete ? formatEuro(a.price_total_cents) : 'nog te bepalen'}</Text>} />
          <Row label="Duur" value={formatDuration(a.duration_min)} />
          <Row label="Buffer na afloop" value={`${a.buffer_min} min`} />
          {a.deviates_from_standard ? <Text style={{ color: colors.warning, marginTop: space.sm }}>✎ Prijs of duur wijkt af van de standaard</Text> : null}
        </Card>
      </Section>

      <Section title="Planning">
        <Card>
          <Row label="Uitvoerende partij" value={team?.name ?? 'Niet toegewezen'} />
          <Row label="Medewerker" value={profileName(a.assignee_id) ?? 'Geen'} />
          <Row label="Werkplek" value={workstations.data?.find((w) => w.id === a.workstation_id)?.name ?? 'Geen'} />
        </Card>
      </Section>

      {a.internal_notes ? (
        <Section title="Interne opmerkingen">
          <Card>
            <T.Body>{a.internal_notes}</T.Body>
          </Card>
        </Section>
      ) : null}

      <Section title="Foto's">
        {photos.data?.length ? (
          <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
            {photos.data.map((p) =>
              p.url ? (
                <Pressable key={p.id} accessibilityLabel="Foto">
                  <Image source={{ uri: p.url }} style={{ width: 140, height: 140, borderRadius: 8, backgroundColor: colors.surface2 }} />
                </Pressable>
              ) : null,
            )}
          </ScrollView>
        ) : (
          <T.Muted>Nog geen foto's.</T.Muted>
        )}
        <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
          <Button title="Foto maken" variant="secondary" onPress={() => addPhoto(true)} loading={uploading} style={{ flex: 1 }} />
          <Button title="Uit fotobibliotheek" variant="secondary" onPress={() => addPhoto(false)} disabled={uploading} style={{ flex: 1 }} />
        </View>
      </Section>

      {a.status !== 'geannuleerd' ? (
        <Section>
          <Button title="Afspraak annuleren" variant="danger" onPress={() => setCancelOpen(true)} />
          <T.Muted style={{ fontSize: 13, marginTop: 4 }}>Een geannuleerde afspraak blijft bewaard in de historie.</T.Muted>
        </Section>
      ) : null}

      <Section title="Wijzigingshistorie">
        <Card>
          <T.Muted>
            Ingevoerd door {a.created_by_name}
            {creatorNow && creatorNow !== a.created_by_name ? ` (nu: ${creatorNow})` : ''} op {formatDateTime(a.created_at)}
          </T.Muted>
          {a.updated_by_name && a.version > 1 ? (
            <T.Muted>
              Laatst gewijzigd door {a.updated_by_name} op {formatDateTime(a.updated_at)}
            </T.Muted>
          ) : null}
          <View style={{ height: space.sm }} />
          {(events.data ?? []).map((e) => (
            <View key={e.id} style={{ paddingVertical: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>
                {ACTION_LABELS[e.action] ?? e.action} · {e.actor_name}
              </Text>
              <T.Muted style={{ fontSize: 13 }}>
                {formatDateTime(e.created_at)}
                {describeEvent(e.details)}
              </T.Muted>
            </View>
          ))}
        </Card>
      </Section>

      <PromptModal
        visible={cancelOpen}
        title="Afspraak annuleren"
        message="De afspraak blijft bewaard met de status Geannuleerd. Reden (optioneel):"
        placeholder="bv. klant belde af"
        confirmLabel="Annuleren bevestigen"
        destructive
        loading={setStatus.isPending}
        onCancel={() => setCancelOpen(false)}
        onConfirm={async (reason) => {
          setCancelOpen(false);
          await changeStatus('geannuleerd', reason);
        }}
      />
    </Screen>
  );
}

function describeEvent(d: Record<string, unknown>): string {
  const parts: string[] = [];
  const naar = d.naar as { starts_at?: string } | undefined;
  const van = d.van as { starts_at?: string } | undefined;
  if (van?.starts_at && naar?.starts_at) parts.push(`${formatDateTime(van.starts_at)} → ${formatDateTime(naar.starts_at)}`);
  if (d.status_naar) parts.push(`status: ${statusLabel(d.status_van as AppointmentStatus)} → ${statusLabel(d.status_naar as AppointmentStatus)}`);
  if (d.reden) parts.push(`reden: ${d.reden}`);
  if ('prijs_naar' in d) parts.push(`prijs: ${formatEuro(d.prijs_van as number | null)} → ${formatEuro(d.prijs_naar as number | null)}`);
  if (d.team_naar !== undefined) parts.push('partij gewijzigd');
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}
