import { Tabs } from 'expo-router';
import React from 'react';
import { ColorValue, Text } from 'react-native';
import { useAccent } from '../../../components/ui';
import { colors } from '../../../theme';

function Icon({ glyph, color }: { glyph: string; color: ColorValue }) {
  return <Text style={{ color, fontSize: 20, lineHeight: 24 }}>{glyph}</Text>;
}

export default function TabsLayout() {
  const accent = useAccent();
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.bg },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: '800' },
        headerShadowVisible: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 64, paddingTop: 6 },
        tabBarActiveTintColor: accent,
        tabBarInactiveTintColor: colors.textDim,
        tabBarLabelStyle: { fontSize: 13, fontWeight: '600' },
        sceneStyle: { backgroundColor: colors.bg },
        animation: 'none',
      }}
    >
      <Tabs.Screen name="vandaag" options={{ title: 'Vandaag', tabBarIcon: ({ color }) => <Icon glyph="◉" color={color} /> }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda', tabBarIcon: ({ color }) => <Icon glyph="▦" color={color} /> }} />
      <Tabs.Screen name="klanten" options={{ title: 'Klanten', tabBarIcon: ({ color }) => <Icon glyph="☰" color={color} /> }} />
      <Tabs.Screen name="meer" options={{ title: 'Meer', tabBarIcon: ({ color }) => <Icon glyph="⋯" color={color} /> }} />
    </Tabs>
  );
}
