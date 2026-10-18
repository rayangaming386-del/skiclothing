import * as ImagePicker from 'expo-image-picker';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { Button, Card, Field, Notice, Row, Screen, Section, T, useToast } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { toFriendlyError } from '../../../lib/errors';
import { useTeams } from '../../../lib/queries';
import { supabase } from '../../../lib/supabase';
import { colors, space } from '../../../theme';
import { Alert } from '../../../components/Dialog';

export default function MyAccount() {
  const { profile, session, refreshProfile, signOut, isOwner } = useAuth();
  const teams = useTeams();
  const toast = useToast();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(profile?.display_name ?? '');
    setPhone(profile?.phone ?? '');
  }, [profile?.display_name, profile?.phone]);

  const avatar = useQuery({
    queryKey: ['avatar', profile?.avatar_path],
    enabled: !!profile?.avatar_path,
    queryFn: async () => (await supabase.storage.from('avatars').createSignedUrl(profile!.avatar_path!, 3600)).data?.signedUrl ?? null,
  });

  if (!profile || !session) return null;
  const dirty = name.trim() !== profile.display_name || (phone.trim() || null) !== profile.phone;

  const saveProfile = async () => {
    if (!name.trim()) return setError('Naam mag niet leeg zijn.');
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('profiles').update({ display_name: name.trim(), phone: phone.trim() || null }).eq('id', profile.id);
    setBusy(false);
    if (err) return setError(toFriendlyError(err).message);
    await refreshProfile();
    toast('Profiel opgeslagen');
  };

  const pickAvatar = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6, allowsEditing: true, aspect: [1, 1] });
    if (res.canceled || !res.assets?.[0]) return;
    try {
      const body = await (await fetch(res.assets[0].uri)).arrayBuffer();
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const up = await supabase.storage.from('avatars').upload(path, body, { contentType: res.assets[0].mimeType ?? 'image/jpeg', upsert: true });
      if (up.error) throw up.error;
      const { error: err } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', profile.id);
      if (err) throw err;
      await refreshProfile();
      toast('Profielfoto opgeslagen');
    } catch (e) {
      Alert.alert('Mislukt', toFriendlyError(e).message);
    }
  };

  const signOutOthers = () =>
    Alert.alert('Uitloggen op andere apparaten?', 'Alle andere sessies van jouw account worden beëindigd. Dit toestel blijft ingelogd.', [
      { text: 'Annuleren', style: 'cancel' },
      {
        text: 'Uitloggen',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.auth.signOut({ scope: 'others' });
          if (err) Alert.alert('Mislukt', toFriendlyError(err).message);
          else toast('Andere apparaten uitgelogd');
        },
      },
    ]);

  return (
    <Screen>
      <View style={{ alignItems: 'center', marginBottom: space.lg }}>
        {avatar.data ? (
          <Image source={{ uri: avatar.data }} style={{ width: 96, height: 96, borderRadius: 48 }} accessibilityLabel="Profielfoto" />
        ) : (
          <View style={{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
            <T.H1>{profile.display_name.slice(0, 1).toUpperCase()}</T.H1>
          </View>
        )}
        <Button title="Profielfoto wijzigen" variant="ghost" onPress={pickAvatar} />
      </View>

      <Section title="Profiel">
        <Field label="Weergavenaam" value={name} onChangeText={setName} />
        <Field label="Telefoonnummer" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <Button title="Profiel opslaan" onPress={saveProfile} disabled={!dirty} loading={busy} />
      </Section>

      <Section title="Inloggegevens">
        <Card>
          <Row label="Gebruikersnaam" value={profile.username ?? 'Geen'} />
          <Row label="E-mailadres" value={session.user.email ?? ''} />
          {session.user.new_email ? <Notice kind="warning">Wacht op bevestiging: {session.user.new_email}</Notice> : null}
          <Row label="Rol" value={isOwner ? 'Eigenaar' : 'Collega'} />
          <Row label="Uitvoerende partij" value={teams.data?.find((t) => t.id === profile.team_id)?.name ?? 'Geen'} />
        </Card>
        <Row label="Wachtwoord wijzigen" onPress={() => router.push('/account/wachtwoord')} />
        <Row label="E-mailadres wijzigen" onPress={() => router.push('/account/email')} />
        <Row label="Meldingsvoorkeuren" onPress={() => router.push('/account/meldingen')} />
      </Section>

      <Section title="Beveiliging">
        <Button title="Uitloggen op andere apparaten" variant="secondary" onPress={signOutOthers} />
        <Button title="Uitloggen" variant="danger" onPress={() => signOut('local')} style={{ marginTop: space.sm }} />
      </Section>
    </Screen>
  );
}
