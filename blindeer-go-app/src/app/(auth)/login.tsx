import { Link } from 'expo-router';
import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { Button, Field, Notice, Screen, T } from '../../components/ui';
import { toFriendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';
import { colors, space } from '../../theme';

export default function Login() {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const value = login.trim();
    if (!value || !password) {
      setError('Vul je gebruikersnaam (of e-mailadres) en wachtwoord in.');
      return;
    }
    setBusy(true);
    try {
      let email = value.toLowerCase();
      if (!value.includes('@')) {
        // Inloggen met gebruikersnaam: zoek het bijbehorende e-mailadres op.
        const { data, error: lookupErr } = await supabase.rpc('login_email_for', { p_login: value });
        if (lookupErr) throw lookupErr;
        if (!data) {
          setError('Inloggen mislukt: gebruikersnaam of wachtwoord klopt niet.');
          return;
        }
        email = data as string;
      }
      const { error: err } = await supabase.auth.signInWithPassword({ email, password });
      if (err) throw err;
    } catch (err) {
      const f = toFriendlyError(err);
      setError(f.kind === 'auth' && f.title === 'Inloggen mislukt' ? 'Inloggen mislukt: gebruikersnaam of wachtwoord klopt niet.' : `${f.title}: ${f.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ marginTop: 32, marginBottom: 28, alignItems: 'center' }}>
        <Image
          source={require('../../../assets/logo-wide.png')}
          style={{ width: 320, height: 126, maxWidth: '100%' }}
          resizeMode="contain"
          accessibilityLabel="Blindeer & Go"
        />
        <T.Muted style={{ marginTop: space.md }}>Planning, alleen voor het team</T.Muted>
      </View>
      <Field
        label="Gebruikersnaam of e-mailadres"
        value={login}
        onChangeText={setLogin}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
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
