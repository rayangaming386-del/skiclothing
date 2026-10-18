import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Card, Notice, Screen, Section, T } from '../../components/ui';
import { canPromptInstall, deviceKind, isStandalone, isWeb, promptInstall } from '../../lib/pwa';
import { colors, space } from '../../theme';

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.md, marginBottom: space.md }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.text, fontWeight: '800' }}>{n}</Text>
      </View>
      <Text style={{ color: colors.text, fontSize: 16, flex: 1, lineHeight: 24 }}>{children}</Text>
    </View>
  );
}

export default function InstallScreen() {
  const [done, setDone] = useState(false);
  const kind = deviceKind();

  if (!isWeb) return <Screen><Notice>Je gebruikt de app al.</Notice></Screen>;
  if (isStandalone() || done) {
    return (
      <Screen>
        <Notice kind="success">De planning staat op je beginscherm. Open hem voortaan via het icoon "B&G Planning".</Notice>
      </Screen>
    );
  }

  return (
    <Screen>
      <T.Muted>Zet de planning op je beginscherm. Hij opent dan schermvullend met een eigen icoon, net als een app.</T.Muted>
      {canPromptInstall() ? (
        <Button title="Nu op beginscherm zetten" big onPress={async () => setDone(await promptInstall())} style={{ marginTop: space.lg }} />
      ) : null}
      <Section title="iPhone (Safari)">
        <Card>
          {kind === 'ios' ? null : <Text style={{ color: colors.textDim, marginBottom: space.md }}>Open deze website in Safari op je iPhone.</Text>}
          <Step n={1}>Tik onderaan op de knop Deel (vierkantje met pijl omhoog).</Step>
          <Step n={2}>Scrol omlaag en kies "Zet op beginscherm".</Step>
          <Step n={3}>Tik op "Voeg toe". Open de planning voortaan via het icoon.</Step>
        </Card>
      </Section>
      <Section title="Android (Chrome)">
        <Card>
          <Step n={1}>Tik rechtsboven op ⋮ (drie puntjes).</Step>
          <Step n={2}>Kies "Toevoegen aan startscherm" of "App installeren".</Step>
          <Step n={3}>Bevestig. Open de planning voortaan via het icoon.</Step>
        </Card>
      </Section>
      <Notice>Log na het toevoegen één keer in via het icoon: de app op het beginscherm onthoudt zijn eigen inlog.</Notice>
    </Screen>
  );
}
