import { router } from 'expo-router';
import React, { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Field, Notice, Screen, T, useToast } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { toFriendlyError } from '../../../lib/errors';
import { supabase } from '../../../lib/supabase';
import { passwordProblem } from '../../../lib/validation';
import { space } from '../../../theme';

export default function ChangePassword() {
  const { session } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [repeat, setRepeat] = useState('');
  const [nonceNeeded, setNonceNeeded] = useState(false);
  const [nonce, setNonce] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    toast('Wachtwoord gewijzigd');
    Alert.alert('Wachtwoord gewijzigd', 'Wil je ook op je andere apparaten uitloggen?', [
      { text: 'Nee', onPress: () => router.back() },
      {
        text: 'Ja, uitloggen',
        onPress: async () => {
          await supabase.auth.signOut({ scope: 'others' });
          router.back();
        },
      },
    ]);
  };

  const submit = async () => {
    setError(null);
    const problem = passwordProblem(pw, repeat);
    if (problem) return setError(problem);
    if (pw === current) return setError('Kies een ander wachtwoord dan je huidige.');
    setBusy(true);
    try {
      if (!nonceNeeded) {
        // Opnieuw verifiëren met het huidige wachtwoord.
        const { error: authErr } = await supabase.auth.signInWithPassword({ email: session!.user.email!, password: current });
        if (authErr) {
          setError('Je huidige wachtwoord klopt niet.');
          return;
        }
      }
      const { error: err } = await supabase.auth.updateUser(nonceNeeded ? { password: pw, nonce: nonce.trim() } : { password: pw });
      if (err) {
        if (/reauthentication/i.test(err.message) && !nonceNeeded) {
          // Server vraagt extra bevestiging (Secure password change): code per e-mail.
          const r = await supabase.auth.reauthenticate();
          if (r.error) throw r.error;
          setNonceNeeded(true);
          setError(null);
          return;
        }
        throw err;
      }
      done();
    } catch (e) {
      const f = toFriendlyError(e);
      setError(`${f.title}: ${f.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T.Muted style={{ marginBottom: space.lg }}>Voor je veiligheid vragen we eerst je huidige wachtwoord.</T.Muted>
      <Field label="Huidig wachtwoord" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" editable={!nonceNeeded} />
      <Field label="Nieuw wachtwoord" value={pw} onChangeText={setPw} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="Minimaal 10 tekens, letters en cijfers" />
      <Field label="Herhaal nieuw wachtwoord" value={repeat} onChangeText={setRepeat} secureTextEntry autoComplete="new-password" textContentType="newPassword" />
      {nonceNeeded ? (
        <>
          <Notice>We hebben een bevestigingscode naar {session?.user.email} gestuurd.</Notice>
          <Field label="Bevestigingscode" value={nonce} onChangeText={setNonce} keyboardType="number-pad" textContentType="oneTimeCode" />
        </>
      ) : null}
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Wachtwoord wijzigen" onPress={submit} loading={busy} big />
    </Screen>
  );
}
