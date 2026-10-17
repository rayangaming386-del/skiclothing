import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ToastProvider } from '../components/ui';
import { AuthProvider } from '../lib/auth';
import { isConfigured } from '../lib/supabase';
import { colors } from '../theme';

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 2, staleTime: 15_000, refetchOnReconnect: true },
          // Mutaties nooit automatisch herhalen: opslaan gebeurt alleen bewust en wordt server-side bevestigd.
          mutations: { retry: false, networkMode: 'always' },
        },
      }),
  );

  if (!isConfigured) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 12 }}>App niet geconfigureerd</Text>
        <Text style={{ color: colors.textDim, fontSize: 16 }}>
          Vul EXPO_PUBLIC_SUPABASE_URL en EXPO_PUBLIC_SUPABASE_ANON_KEY in (zie .env.example en docs/SETUP.md).
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: 'none',
              }}
            />
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
