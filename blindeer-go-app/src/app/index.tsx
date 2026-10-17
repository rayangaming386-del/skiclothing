import { Redirect } from 'expo-router';
import React from 'react';
import { Loading } from '../components/ui';
import { useAuth } from '../lib/auth';

export default function Index() {
  const { session, loading, mustSetPassword } = useAuth();
  if (loading) return <Loading />;
  if (!session) return <Redirect href="/login" />;
  if (mustSetPassword) return <Redirect href="/nieuw-wachtwoord" />;
  return <Redirect href="/vandaag" />;
}
