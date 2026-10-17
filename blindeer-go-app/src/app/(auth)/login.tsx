import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, Notice, Screen, T } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError('Vul je e-mailadres en wachtwoord in.');
      return;
    }
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (err) {
      const f = toFriendlyError(err);
      setError(`${f.title}: ${f.message}`);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ marginTop: 48, marginBottom: 32 }}>
        <T.H1>Blindeer & Go</T.H1>
        <T.Muted style={{ marginTop: space.xs }}>Planning — alleen voor het team</T.Muted>
      </View>
      <Field
        label="E-mailadres"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
      />
      <Field
        label="Wachtwoord"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        returnKeyType="go"
        onSubmitEditing={submit}
      />
      {error ? <Notice kind="danger">{error}</Notice> : null}
      <Button title="Inloggen" onPress={submit} loading={busy} big style={{ marginTop: space.sm }} />
      <View style={{ marginTop: space.xl, gap: space.lg, alignItems: 'center' }}>
        <Link href="/wachtwoord-vergeten" style={{ color: colors.text, fontSize: 16, padding: 8 }}>
          Wachtwoord vergeten?
        </Link>
        <Link href="/uitnodiging" style={{ color: colors.text, fontSize: 16, padding: 8 }}>
          Uitnodiging ontvangen? Account activeren
        </Link>
      </View>
      <Text style={{ color: colors.textFaint, textAlign: 'center', marginTop: 40, fontSize: 13 }}>
        Accounts worden aangemaakt door de beheerder. Zelf registreren is niet mogelijk.
      </Text>
    </Screen>
  );
}
