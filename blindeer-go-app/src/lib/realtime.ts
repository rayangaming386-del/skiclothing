import { focusManager, onlineManager, useQueryClient } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { qk } from './queries';
import { supabase } from './supabase';

const TABLE_KEYS: Record<string, readonly unknown[][]> = {
  appointments: [qk.appointments as unknown as unknown[]],
  blocks: [qk.blocks as unknown as unknown[]],
  customers: [qk.customers as unknown as unknown[]],
  vehicles: [qk.customers as unknown as unknown[]],
  profiles: [qk.profiles as unknown as unknown[]],
  teams: [qk.teams as unknown as unknown[]],
  company_settings: [qk.settings as unknown as unknown[]],
  opening_hours: [qk.schedule as unknown as unknown[]],
  recurring_breaks: [qk.schedule as unknown as unknown[]],
  date_overrides: [qk.schedule as unknown as unknown[]],
};

/**
 * Luistert naar databasewijzigingen (Supabase Realtime, respecteert RLS) en ververst de betreffende gegevens.
 * Daarnaast wordt bij terugkeer van de verbinding alles opnieuw opgehaald, zodat een gemiste melding
 * nooit tot verouderde gegevens leidt.
 */
export function useRealtimeSync(enabled: boolean) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'verbonden' | 'verbinden' | 'onderbroken'>('verbinden');

  useEffect(() => {
    if (!enabled) return;
    let channel = supabase.channel('planning-sync');
    for (const table of Object.keys(TABLE_KEYS)) {
      channel = channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
        for (const key of TABLE_KEYS[table]) qc.invalidateQueries({ queryKey: key });
      });
    }
    channel.subscribe((s) => {
      if (s === 'SUBSCRIBED') {
        setStatus('verbonden');
        qc.invalidateQueries(); // na (her)verbinden alles verversen
      } else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
        setStatus('onderbroken');
      }
    });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, qc]);

  return status;
}

/** Koppelt de netwerkstatus van het toestel aan React Query en geeft online/offline terug. */
export function useOnline() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const apply = (s: Network.NetworkState) => {
      const isOnline = s.isConnected !== false && s.isInternetReachable !== false;
      setOnline(isOnline);
      onlineManager.setOnline(isOnline);
    };
    Network.getNetworkStateAsync().then(apply).catch(() => undefined);
    const sub = Network.addNetworkStateListener(apply);
    return () => sub.remove();
  }, []);
  return online;
}

/** Ververs gegevens zodra de app weer op de voorgrond komt (vangnet naast Realtime). */
export function useRefetchOnForeground() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = AppState.addEventListener('change', (state) => focusManager.setFocused(state === 'active'));
    return () => sub.remove();
  }, []);
}
