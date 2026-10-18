import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { OfflineBanner } from '../../components/planning';
import { Button, Loading, T } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { useSettings } from '../../lib/queries';
import { useOnline, useRealtimeSync, useRefetchOnForeground } from '../../lib/realtime';
import { colors, space } from '../../theme';

export default function AppLayout() {
  const { session, profile, loading, mustSetPassword, signOut } = useAuth();
  const insets = useSafeAreaInsets();
  const online = useOnline();
  useRefetchOnForeground();
  const realtime = useRealtimeSync(!!session && !!profile?.active);
  useSettings(); // laadt o.a. de bedrijfstijdzone

  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  if (mustSetPassword) return <Redirect href="/nieuw-wachtwoord" />;
  if (!profile) return <Loading label="Account laden…" />;
  if (!profile.active) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: space.xl, justifyContent: 'center' }}>
        <T.H2>Account uitgeschakeld</T.H2>
        <T.Muted style={{ marginVertical: space.lg }}>
          Je hebt geen toegang meer tot de planning. Neem contact op met de beheerder als dit niet klopt.
        </T.Muted>
        <Button title="Uitloggen" onPress={() => signOut('local')} />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      {!online || realtime === 'onderbroken' ? (
        <View style={{ paddingTop: insets.top, backgroundColor: colors.warning }}>
          <OfflineBanner online={online} realtime={realtime} />
        </View>
      ) : null}
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.bg },
          headerTintColor: colors.text,
          headerTitleStyle: { fontWeight: '700' },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.bg },
          headerBackTitle: 'Terug',
          animation: 'none',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="afspraak/nieuw" options={{ title: 'Afspraak' }} />
        <Stack.Screen name="afspraak/[id]" options={{ title: 'Afspraak' }} />
        <Stack.Screen name="klant/[id]" options={{ title: 'Klant' }} />
        <Stack.Screen name="klant/bewerken" options={{ title: 'Klantgegevens' }} />
        <Stack.Screen name="klant/voertuig" options={{ title: 'Auto' }} />
        <Stack.Screen name="account/index" options={{ title: 'Mijn account' }} />
        <Stack.Screen name="account/wachtwoord" options={{ title: 'Wachtwoord wijzigen' }} />
        <Stack.Screen name="account/email" options={{ title: 'E-mailadres wijzigen' }} />
        <Stack.Screen name="account/meldingen" options={{ title: 'Meldingen' }} />
        <Stack.Screen name="beheer/team" options={{ title: 'Team & toegang' }} />
        <Stack.Screen name="beheer/tabel" options={{ title: 'Beheer' }} />
        <Stack.Screen name="installeren" options={{ title: 'Op beginscherm zetten' }} />
      </Stack>
    </View>
  );
}
