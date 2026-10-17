import React from 'react';
import { Text, View } from 'react-native';
import { BODY_TYPES, BodyType, suggestHighEntry } from '../lib/pricing';
import { useModelHints } from '../lib/queries';
import { colors, space } from '../theme';
import { Chip, ChipRow, Field } from './ui';

export interface VehicleDraft {
  plate: string;
  make: string;
  model: string;
  variant: string;
  build_year: string;
  body_type: BodyType | null;
  door_count: number | null;
  rear_window_count: number | null;
  front_window_count: number | null;
  high_entry: boolean | null;
  notes: string;
}

export const emptyVehicle: VehicleDraft = {
  plate: '',
  make: '',
  model: '',
  variant: '',
  build_year: '',
  body_type: null,
  door_count: null,
  rear_window_count: null,
  front_window_count: null,
  high_entry: null,
  notes: '',
};

export function draftToRow(d: VehicleDraft) {
  const year = parseInt(d.build_year, 10);
  return {
    plate: d.plate.trim() || null,
    make: d.make.trim() || null,
    model: d.model.trim() || null,
    variant: d.variant.trim() || null,
    build_year: Number.isFinite(year) ? year : null,
    body_type: d.body_type,
    door_count: d.door_count,
    rear_window_count: d.rear_window_count,
    front_window_count: d.front_window_count,
    high_entry: d.high_entry,
    notes: d.notes.trim() || null,
  };
}

export function rowToDraft(v: Partial<ReturnType<typeof draftToRow>> | null | undefined): VehicleDraft {
  if (!v) return { ...emptyVehicle };
  return {
    plate: v.plate ?? '',
    make: v.make ?? '',
    model: v.model ?? '',
    variant: v.variant ?? '',
    build_year: v.build_year ? String(v.build_year) : '',
    body_type: v.body_type ?? null,
    door_count: v.door_count ?? null,
    rear_window_count: v.rear_window_count ?? null,
    front_window_count: v.front_window_count ?? null,
    high_entry: v.high_entry ?? null,
    notes: v.notes ?? '',
  };
}

function NumberChips({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: number | null;
  options: number[];
  onChange: (n: number | null) => void;
}) {
  return (
    <View style={{ marginBottom: space.md }}>
      <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>{label}</Text>
      <ChipRow>
        {options.map((n) => (
          <Chip key={n} label={String(n)} selected={value === n} onPress={() => onChange(value === n ? null : n)} />
        ))}
        <Chip label="Onbekend" selected={value == null} onPress={() => onChange(null)} />
      </ChipRow>
    </View>
  );
}

export function VehicleForm({ value, onChange }: { value: VehicleDraft; onChange: (v: VehicleDraft) => void }) {
  const hints = useModelHints();
  const set = <K extends keyof VehicleDraft>(k: K, v: VehicleDraft[K]) => onChange({ ...value, [k]: v });
  const suggestion = suggestHighEntry(hints.data ?? [], { make: value.make, model: value.model, variant: value.variant, body_type: value.body_type });

  return (
    <View>
      <Field label="Kenteken (optioneel)" value={value.plate} onChangeText={(t) => set('plate', t.toUpperCase())} autoCapitalize="characters" autoCorrect={false} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Field label="Merk" value={value.make} onChangeText={(t) => set('make', t)} style={{ flex: 1 }} autoCorrect={false} />
        <Field label="Model" value={value.model} onChangeText={(t) => set('model', t)} style={{ flex: 1 }} autoCorrect={false} placeholder="bv. Golf 5" />
      </View>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Field label="Uitvoering" value={value.variant} onChangeText={(t) => set('variant', t)} style={{ flex: 2 }} autoCorrect={false} />
        <Field label="Bouwjaar" value={value.build_year} onChangeText={(t) => set('build_year', t.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" style={{ flex: 1 }} />
      </View>

      <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Carrosserie</Text>
      <ChipRow>
        {BODY_TYPES.map((b) => (
          <Chip key={b.value} label={b.label} selected={value.body_type === b.value} onPress={() => set('body_type', value.body_type === b.value ? null : b.value)} />
        ))}
      </ChipRow>
      <View style={{ height: space.md }} />

      {value.body_type === 'hatchback' ? <NumberChips label="Aantal deuren" value={value.door_count} options={[3, 5]} onChange={(n) => set('door_count', n)} /> : null}
      <NumberChips label="Achterramen (vanaf B-stijl)" value={value.rear_window_count} options={[3, 5, 7]} onChange={(n) => set('rear_window_count', n)} />
      {value.body_type === 'bus' ? <NumberChips label="Ramen voorportieren" value={value.front_window_count} options={[2, 4]} onChange={(n) => set('front_window_count', n)} /> : null}

      <Text style={{ color: colors.textDim, fontSize: 13, fontWeight: '600', marginBottom: 6 }}>Instap (voor voorruitprijs)</Text>
      <ChipRow>
        <Chip label="Gewoon" selected={value.high_entry === false} onPress={() => set('high_entry', false)} />
        <Chip label="Hoge instap" selected={value.high_entry === true} onPress={() => set('high_entry', true)} />
        <Chip label="Onbekend" selected={value.high_entry == null} onPress={() => set('high_entry', null)} />
      </ChipRow>
      {value.high_entry == null && suggestion != null ? (
        <Text style={{ color: colors.info, marginTop: 6 }} onPress={() => set('high_entry', suggestion)}>
          Suggestie: {suggestion ? 'hoge instap' : 'gewone instap'} — tik om over te nemen
        </Text>
      ) : null}
      <View style={{ height: space.md }} />
      <Field label="Opmerkingen over de auto" value={value.notes} onChangeText={(t) => set('notes', t)} multiline />
    </View>
  );
}
