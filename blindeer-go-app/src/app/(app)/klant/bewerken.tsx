import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Field, Loading, Notice, Screen, useToast } from '../../../components/ui';
import { toFriendlyError } from '../../../lib/errors';
import { qk, useCustomer } from '../../../lib/queries';
import { supabase } from '../../../lib/supabase';
import { isEmail } from '../../../lib/validation';
import { space } from '../../../theme';

export default function EditCustomer() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useCustomer(id);
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!id);

  useEffect(() => {
    const c = existing.data?.customer;
    if (c && !loaded) {
      setName(c.name);
      setPhone(c.phone ?? '');
      setEmail(c.email ?? '');
      setNotes(c.notes ?? '');
      setLoaded(true);
    }
  }, [existing.data, loaded]);

  if (!loaded) return <Loading />;

  const save = async () => {
    if (!name.trim()) return setError('Naam is verplicht.');
    if (email.trim() && !isEmail(email)) return setError('E-mailadres lijkt niet te kloppen.');
    setBusy(true);
    setError(null);
    const row = { name: name.trim(), phone: phone.trim() || null, email: email.trim() || null, notes: notes.trim() || null };
    const res = id ? await supabase.from('customers').update(row).eq('id', id).select().single() : await supabase.from('customers').insert(row).select().single();
    setBusy(false);
    if (res.error) return setError(toFriendlyError(res.error).message);
    qc.invalidateQueries({ queryKey: qk.customers });
    toast('Klant opgeslagen');
    if (id) router.back();
    else router.replace(`/klant/${res.data.id}`);
  };

  const archive = () =>
    Alert.alert('Klant archiveren?', 'De klant verdwijnt uit de zoekresultaten. Eerdere afspraken blijven bewaard.', [
      { text: 'Annuleren', style: 'cancel' },
      {
        text: 'Archiveren',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from('customers').update({ archived_at: new Date().toISOString() }).eq('id', id!);
          if (err) return Alert.alert('Mislukt', toFriendlyError(err).message);
          qc.invalidateQueries({ queryKey: qk.customers });
          toast('Klant gearchiveerd');
          router.replace('/klanten');
        },
      },
    ]);

  return (
    <Screen footer={<Button title="Opslaan" onPress={save} loading={busy} big />}>
      <Stack.Screen options={{ title: id ? 'Klant bewerken' : 'Nieuwe klant' }} />
      <Field label="Naam *" value={name} onChangeText={setName} autoCapitalize="words" />
      <Field label="Telefoonnummer" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
      <Field label="E-mailadres (optioneel)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Interne opmerkingen" value={notes} onChangeText={setNotes} multiline />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      {id ? <Button title="Klant archiveren" variant="ghost" onPress={archive} style={{ marginTop: space.lg }} /> : null}
    </Screen>
  );
}
