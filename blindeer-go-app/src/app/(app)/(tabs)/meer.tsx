import { router } from 'expo-router';
import React from 'react';

import { Button, Card, Row, Screen, Section, T } from '../../../components/ui';
import { useAuth } from '../../../lib/auth';
import { isStandalone, isWeb } from '../../../lib/pwa';
import { space } from '../../../theme';
import { Alert } from '../../../components/Dialog';

export default function More() {
  const { profile, isOwner, signOut } = useAuth();
  const go = (path: string) => () => router.push(path as never);
  const table = (name: string) => () => router.push({ pathname: '/beheer/tabel', params: { naam: name } });

  return (
    <Screen>
      <Card onPress={go('/account')}>
        <T.H2>{profile?.display_name}</T.H2>
        <T.Muted>
          {profile?.email} · {isOwner ? 'Eigenaar' : 'Collega'}
        </T.Muted>
        <T.Muted style={{ marginTop: space.xs }}>Mijn account ›</T.Muted>
      </Card>

      {isWeb && !isStandalone() ? (
        <Section title="App">
          <Row label="Op beginscherm zetten" onPress={go('/installeren')} />
        </Section>
      ) : null}

      <Section title="Planning">
        <Row label="Blokkades & afwezigheid" onPress={table('blokkades')} />
        <Row label="Diensten & prijzen (bekijken)" onPress={table('diensten')} />
      </Section>

      {isOwner ? (
        <>
          <Section title="Beheer (eigenaar)">
            <Row label="Team & toegang" onPress={go('/beheer/team')} />
            <Row label="Uitvoerende partijen & kleuren" onPress={table('partijen')} />
            <Row label="Bedrijfsgegevens & regels" onPress={table('bedrijf')} />
            <Row label="Openingstijden" onPress={table('openingstijden')} />
            <Row label="Pauzes" onPress={table('pauzes')} />
            <Row label="Afwijkende dagen" onPress={table('afwijkend')} />
            <Row label="Werkplekken" onPress={table('werkplekken')} />
          </Section>
          <Section title="Catalogus (eigenaar)">
            <Row label="Diensten & folies" onPress={table('diensten')} />
            <Row label="Prijzen & behandeltijden" onPress={table('prijzen')} />
            <Row label="Modeluitzonderingen" onPress={table('uitzonderingen')} />
            <Row label="Pakketten" onPress={table('pakketten')} />
            <Row label="Kortingsregels" onPress={table('kortingen')} />
            <Row label="Hoge instap per model" onPress={table('instap')} />
          </Section>
        </>
      ) : (
        <Section title="Beheer">
          <T.Muted>Bedrijfsregels, prijzen en gebruikers worden beheerd door de eigenaar.</T.Muted>
        </Section>
      )}

      <Section title="Sessie">
        <Button
          title="Uitloggen"
          variant="secondary"
          onPress={() =>
            Alert.alert('Uitloggen?', 'Je gegevens worden van dit toestel gewist tot je opnieuw inlogt.', [
              { text: 'Annuleren', style: 'cancel' },
              { text: 'Uitloggen', style: 'destructive', onPress: () => signOut('local') },
            ])
          }
        />
      </Section>
    </Screen>
  );
}
