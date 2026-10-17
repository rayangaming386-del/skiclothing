import { Redirect, Stack } from 'expo-router';
import React from 'react';
import { Loading } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { colors } from '../../theme';

export default function AuthLayout() {
  const { session, loading, mustSetPassword } = useAuth();
  if (loading) return <Loading />;
  if (session && !mustSetPassword) return <Redirect href="/vandaag" />;
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.bg },
        headerBackTitle: 'Terug',
        animation: 'none',
      }}
    >
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="wachtwoord-vergeten" options={{ title: 'Wachtwoord vergeten' }} />
      <Stack.Screen name="uitnodiging" options={{ title: 'Uitnodiging accepteren' }} />
      <Stack.Screen name="nieuw-wachtwoord" options={{ title: 'Wachtwoord instellen', headerBackVisible: false }} />
    </Stack>
  );
}
