import { Redirect, router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Field, Notice, Screen, T, useToast } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { toFriendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { passwordProblem } from '../../lib/validation';
import { space } from '../../theme';

export default function SetNewPassword() {
  const { session, mustSetPassword, setMustSetPassword, profile } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!session) return <Redirect href="/login" />;

  const save = async () => {
    const problem = passwordProblem(pw, repeat);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (err) {
      const f = toFriendlyError(err);
      setError(`${f.title}: ${f.message}`);
      return;
    }
    setMustSetPassword(null);
    toast('Wachtwoord opgeslagen');
    router.replace('/vandaag');
  };

  return (
    <Screen>
      <T.H2>{mustSetPassword === 'invite' ? `Welkom${profile ? `, ${profile.display_name}` : ''}` : 'Nieuw wachtwoord'}</T.H2>
      <T.Muted style={{ marginVertical: space.md }}>Kies een wachtwoord van minimaal 10 tekens met letters en cijfers.</T.Muted>
      <Field label="Nieuw wachtwoord" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      <Field label="Herhaal wachtwoord" value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Opslaan" onPress={save} loading={busy} big />
    </Screen>
  );
}
