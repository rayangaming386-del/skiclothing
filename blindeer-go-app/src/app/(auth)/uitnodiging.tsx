import { router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Field, Notice, Screen, T } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { toFriendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme';

export default function AcceptInvite() {
  const { setMustSetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const verify = async () => {
    setError(null);
    setBusy(true);
    setMustSetPassword('invite');
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'invite' });
    setBusy(false);
    if (err) {
      setMustSetPassword(null);
      const f = toFriendlyError(err);
      setError(`${f.title}: ${f.message}`);
      return;
    }
    router.replace('/nieuw-wachtwoord');
  };

  return (
    <Screen>
      <T.Muted style={{ marginBottom: space.lg }}>
        De beheerder heeft je uitgenodigd. Vul het e-mailadres in waarop je de uitnodiging kreeg en de code uit die e-mail.
        Daarna kies je je eigen wachtwoord.
      </T.Muted>
      <Field label="E-mailadres" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" autoComplete="email" />
      <Field
        label="Code uit de uitnodiging"
        value={code}
        onChangeText={setCode}
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={10}
      />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Account activeren" onPress={verify} loading={busy} disabled={!email.trim() || code.trim().length < 6} big />
      <T.Muted style={{ marginTop: space.lg, fontSize: 14 }}>
        Code verlopen? Vraag de beheerder om de uitnodiging opnieuw te versturen.
      </T.Muted>
    </Screen>
  );
}
