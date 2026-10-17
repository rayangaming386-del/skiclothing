import React, { useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { Button, Chip, ChipRow, Notice, Screen, Section, styles as ui, useToast } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { toFriendlyError } from '../../../lib/errors';
import { supabase } from '../../../lib/supabase';
import { NotificationPrefs } from '../../../lib/types';
import { colors, space } from '../../../theme';

export default function NotificationSettings() {
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs>(
    profile?.notification_prefs ?? { assigned: true, moved: true, cancelled: true, reminder_minutes: null },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('profiles').update({ notification_prefs: prefs }).eq('id', profile!.id);
    setBusy(false);
    if (err) return setError(toFriendlyError(err).message);
    await refreshProfile();
    toast('Voorkeuren opgeslagen');
  };

  const toggle = (key: 'assigned' | 'moved' | 'cancelled', label: string) => (
    <View style={[ui.row, { justifyContent: 'space-between' }]}>
      <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>{label}</Text>
      <Switch value={prefs[key]} onValueChange={(v) => setPrefs({ ...prefs, [key]: v })} accessibilityLabel={label} />
    </View>
  );

  return (
    <Screen footer={<Button title="Opslaan" onPress={save} loading={busy} big />}>
      <Notice>
        Pushmeldingen staan gepland voor de volgende versie. Je voorkeuren worden nu al bewaard en gebruikt zodra meldingen aan staan.
      </Notice>
      <Section title="Stuur mij een melding bij">
        {toggle('assigned', 'Een afspraak die aan mij/mijn partij is toegewezen')}
        {toggle('moved', 'Verplaatsing van zo’n afspraak')}
        {toggle('cancelled', 'Annulering van zo’n afspraak')}
      </Section>
      <Section title="Herinnering vooraf">
        <ChipRow>
          {[null, 15, 30, 60, 120].map((m) => (
            <Chip key={String(m)} label={m == null ? 'Geen' : m < 60 ? `${m} min` : `${m / 60} uur`} selected={prefs.reminder_minutes === m} onPress={() => setPrefs({ ...prefs, reminder_minutes: m })} />
          ))}
        </ChipRow>
      </Section>
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <View style={{ height: space.xl }} />
    </Screen>
  );
}
