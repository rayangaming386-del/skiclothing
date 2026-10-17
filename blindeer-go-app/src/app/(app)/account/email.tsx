import { router } from 'expo-router';
import React, { useState } from 'react';
import { Button, Field, Notice, Screen, T, useToast } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { toFriendlyError } from '../../../lib/errors';
import { supabase } from '../../../lib/supabase';
import { isEmail } from '../../../lib/validation';
import { space } from '../../../theme';

export default function ChangeEmail() {
  const { session, refreshProfile } = useAuth();
  const toast = useToast();
  const oldEmail = session?.user.email ?? '';
  const [current, setCurrent] = useState('');
  const [newEmail, setNewEmail] = useState(session?.user.new_email ?? '');
  const [step, setStep] = useState<'form' | 'codes'>(session?.user.new_email ? 'codes' : 'form');
  const [codeNew, setCodeNew] = useState('');
  const [codeOld, setCodeOld] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const request = async () => {
    setError(null);
    const e = newEmail.trim().toLowerCase();
    if (!isEmail(e)) return setError('Vul een geldig nieuw e-mailadres in.');
    if (e === oldEmail.toLowerCase()) return setError('Dit is al je huidige e-mailadres.');
    setBusy(true);
    try {
      const { error: authErr } = await supabase.auth.signInWithPassword({ email: oldEmail, password: current });
      if (authErr) return setError('Je wachtwoord klopt niet.');
      const { error: err } = await supabase.auth.updateUser({ email: e });
      if (err) throw err;
      setStep('codes');
      setInfo(`Er is een code gestuurd naar ${e}. Mogelijk ook een code naar je huidige adres ${oldEmail}. Je huidige adres blijft actief tot de bevestiging is afgerond.`);
    } catch (x) {
      const f = toFriendlyError(x);
      setError(`${f.title}: ${f.message}`);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    setError(null);
    setBusy(true);
    try {
      const target = newEmail.trim().toLowerCase();
      if (codeOld.trim()) {
        const r = await supabase.auth.verifyOtp({ email: oldEmail, token: codeOld.trim(), type: 'email_change' });
        if (r.error) throw r.error;
      }
      if (codeNew.trim()) {
        const r = await supabase.auth.verifyOtp({ email: target, token: codeNew.trim(), type: 'email_change' });
        if (r.error) throw r.error;
      }
      const { data } = await supabase.auth.getUser();
      if (data.user?.email?.toLowerCase() === target) {
        await refreshProfile();
        toast('E-mailadres gewijzigd');
        router.back();
      } else {
        setInfo('Bevestiging ontvangen. Vul ook de code van het andere adres in om de wijziging af te ronden.');
      }
    } catch (x) {
      const f = toFriendlyError(x);
      setError(`${f.title}: ${f.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <T.Muted style={{ marginBottom: space.lg }}>Huidig inlogadres: {oldEmail}</T.Muted>
      {step === 'form' ? (
        <>
          <Field label="Nieuw e-mailadres" value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" />
          <Field label="Je wachtwoord (ter bevestiging)" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" />
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button title="Code versturen" onPress={request} loading={busy} big />
        </>
      ) : (
        <>
          {info ? <Notice>{info}</Notice> : null}
          <Field label={`Code gestuurd naar ${newEmail || 'nieuw adres'}`} value={codeNew} onChangeText={setCodeNew} keyboardType="number-pad" textContentType="oneTimeCode" />
          <Field label={`Code gestuurd naar ${oldEmail} (indien ontvangen)`} value={codeOld} onChangeText={setCodeOld} keyboardType="number-pad" />
          {error ? <Notice kind="danger">{error}</Notice> : null}
          <Button title="Bevestigen" onPress={confirm} loading={busy} disabled={!codeNew.trim() && !codeOld.trim()} big />
          <Button title="Opnieuw beginnen" variant="ghost" onPress={() => setStep('form')} style={{ marginTop: space.sm }} />
        </>
      )}
    </Screen>
  );
}
