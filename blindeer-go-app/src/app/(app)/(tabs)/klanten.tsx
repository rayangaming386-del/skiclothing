import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { Button, Card, Empty, ErrorState, Loading, styles as ui } from '../../../components/ui';
import { useCustomerSearch } from '../../../lib/queries';
import { colors, space } from '../../../theme';

function useDebounced<T>(value: T, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Customers() {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term);
  const q = useCustomerSearch(debounced);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, padding: space.lg }}>
      <TextInput
        value={term}
        onChangeText={setTerm}
        placeholder="Zoek op naam, telefoon of kenteken"
        placeholderTextColor={colors.textFaint}
        style={ui.input}
        autoCorrect={false}
        clearButtonMode="while-editing"
        accessibilityLabel="Zoek klant"
      />
      <Button title="Nieuwe klant" icon="＋" variant="secondary" onPress={() => router.push('/klant/bewerken')} style={{ marginVertical: space.md }} />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <FlatList
          data={q.data}
          keyExtractor={(c) => c.id}
          keyboardShouldPersistTaps="handled"
          refreshing={q.isRefetching}
          onRefresh={() => q.refetch()}
          ListEmptyComponent={<Empty title={term ? 'Niets gevonden' : 'Nog geen klanten'} text={term ? 'Probeer een andere zoekterm.' : undefined} />}
          renderItem={({ item }) => (
            <Card onPress={() => router.push(`/klant/${item.id}`)} accessibilityLabel={`Klant ${item.name}`}>
              <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{item.name}</Text>
              <Text style={{ color: colors.textDim, marginTop: 2 }}>{item.phone || 'Geen telefoonnummer'}</Text>
              {item.vehicles?.length ? (
                <Text style={{ color: colors.textDim, marginTop: 2 }} numberOfLines={1}>
                  🚗 {item.vehicles
                    .filter((v) => !v.archived_at)
                    .map((v) => [v.plate?.toUpperCase(), v.make, v.model].filter(Boolean).join(' '))
                    .join(' · ')}
                </Text>
              ) : null}
            </Card>
          )}
        />
      )}
    </View>
  );
}
