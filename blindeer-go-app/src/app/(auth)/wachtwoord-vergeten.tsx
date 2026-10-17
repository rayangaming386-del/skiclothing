import { router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Field, Notice, Screen, T } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { toFriendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { space } from '../../theme';

export default function ForgotPassword() {
  const { setMustSetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const sendCode = async () => {
    setError(null);
    const e = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError('Vul een geldig e-mailadres in.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(e);
    setBusy(false);
    if (err) {
      const f = toFriendlyError(err);
      setError(`${f.title}: ${f.message}`);
      return;
    }
    // Bewust geen bevestiging of het adres bestaat (voorkomt het raden van accounts).
    setInfo('Als dit adres bij een account hoort, is er een e-mail met een code verstuurd. Kijk ook in je spam.');
    setStep('code');
  };

  const verify = async () => {
    setError(null);
    setBusy(true);
    setMustSetPassword('recovery');
    const { error: err } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: 'recovery' });
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
        Je ontvangt een e-mail met een code. Met die code kies je een nieuw wachtwoord.
      </T.Muted>
      <Field
        label="E-mailadres"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        editable={step === 'email'}
      />
      {step === 'email' ? (
        <>
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button title="Stuur code" onPress={sendCode} loading={busy} big />
          <Button title="Ik heb al een code" variant="ghost" onPress={() => setStep('code')} style={{ marginTop: space.sm }} />
        </>
      ) : (
        <>
          {info ? <Notice>{info}</Notice> : null}
          <Field
            label="Code uit de e-mail"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={10}
          />
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button title="Bevestig code" onPress={verify} loading={busy} disabled={code.trim().length < 6} big />
          <Button title="Nieuwe code sturen" variant="ghost" onPress={sendCode} style={{ marginTop: space.sm }} />
        </>
      )}
    </Screen>
  );
}
