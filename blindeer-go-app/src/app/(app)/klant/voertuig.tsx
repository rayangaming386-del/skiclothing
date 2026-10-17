import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { Button, Loading, Notice, Screen, useToast } from '../../../components/ui';
import { draftToRow, emptyVehicle, rowToDraft, VehicleDraft, VehicleForm } from '../../../components/VehicleForm';
import { toFriendlyError } from '../../../lib/errors';
import { qk, useCustomer } from '../../../lib/queries';
import { supabase } from '../../../lib/supabase';
import { space } from '../../../theme';

export default function EditVehicle() {
  const { customerId, id } = useLocalSearchParams<{ customerId: string; id?: string }>();
  const c = useCustomer(customerId);
  const qc = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<VehicleDraft>({ ...emptyVehicle });
  const [loaded, setLoaded] = useState(!id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const v = c.data?.customer.vehicles.find((x) => x.id === id);
    if (v && !loaded) {
      setDraft(rowToDraft(v));
      setLoaded(true);
    }
  }, [c.data, id, loaded]);

  if (!loaded) return <Loading />;

  const save = async () => {
    setBusy(true);
    setError(null);
    const row = draftToRow(draft);
    const res = id
      ? await supabase.from('vehicles').update(row).eq('id', id)
      : await supabase.from('vehicles').insert({ ...row, customer_id: customerId });
    setBusy(false);
    if (res.error) return setError(toFriendlyError(res.error).message);
    qc.invalidateQueries({ queryKey: qk.customers });
    toast('Auto opgeslagen');
    router.back();
  };

  const archive = () =>
    Alert.alert('Auto verwijderen uit lijst?', 'Eerdere afspraken met deze auto blijven bewaard.', [
      { text: 'Annuleren', style: 'cancel' },
      {
        text: 'Verwijderen',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from('vehicles').update({ archived_at: new Date().toISOString() }).eq('id', id!);
          if (err) return Alert.alert('Mislukt', toFriendlyError(err).message);
          qc.invalidateQueries({ queryKey: qk.customers });
          router.back();
        },
      },
    ]);

  return (
    <Screen footer={<Button title="Opslaan" onPress={save} loading={busy} big />}>
      <Stack.Screen options={{ title: id ? 'Auto bewerken' : 'Auto toevoegen' }} />
      <VehicleForm value={draft} onChange={setDraft} />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      {id ? <Button title="Auto uit lijst verwijderen" variant="ghost" onPress={archive} style={{ marginTop: space.lg }} /> : null}
    </Screen>
  );
}
