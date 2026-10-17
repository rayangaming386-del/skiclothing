import type { Session } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import type { Profile } from './types';

interface AuthState {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Na een invite- of herstelcode moet eerst een (nieuw) wachtwoord worden gekozen. */
  mustSetPassword: 'invite' | 'recovery' | null;
  setMustSetPassword: (v: 'invite' | 'recovery' | null) => void;
  refreshProfile: () => Promise<void>;
  signOut: (scope?: 'local' | 'global') => Promise<void>;
  isOwner: boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [mustSetPassword, setMustSetPassword] = useState<'invite' | 'recovery' | null>(null);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      return;
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    setProfile((data as Profile) ?? null);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'SIGNED_OUT') {
        // Gevoelige gegevens uit het geheugen wissen.
        queryClient.clear();
        setProfile(null);
        setMustSetPassword(null);
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'INITIAL_SESSION') {
        // Laden buiten de callback om (aanbevolen: geen await op auth-calls in onAuthStateChange).
        setTimeout(() => loadProfile(s?.user.id), 0);
      }
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile, queryClient]);

  // Profiel actueel houden (bv. uitgeschakeld door eigenaar of rol gewijzigd).
  useEffect(() => {
    const uid = session?.user.id;
    if (!uid) return;
    const channel = supabase
      .channel(`profile-${uid}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles', filter: `id=eq.${uid}` }, (payload) => {
        setProfile(payload.new as Profile);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user.id]);

  const signOut = useCallback(
    async (scope: 'local' | 'global' = 'local') => {
      try {
        await supabase.auth.signOut({ scope });
      } finally {
        // Ook bij een netwerkfout lokaal alles wissen.
        queryClient.clear();
        setSession(null);
        setProfile(null);
        setMustSetPassword(null);
      }
    },
    [queryClient],
  );

  const value = useMemo<AuthState>(
    () => ({
      session,
      profile,
      loading,
      mustSetPassword,
      setMustSetPassword,
      refreshProfile: () => loadProfile(session?.user.id),
      signOut,
      isOwner: !!profile?.active && profile.role === 'owner',
    }),
    [session, profile, loading, mustSetPassword, loadProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth buiten AuthProvider');
  return ctx;
}
