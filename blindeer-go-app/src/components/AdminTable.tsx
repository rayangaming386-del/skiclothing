// Generieke beheer-editor: lijst + formulier voor één tabel, aangestuurd door een veldconfiguratie.
// Schrijfrechten worden door de database (RLS) afgedwongen; hier alleen verborgen voor de duidelijkheid.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { toFriendlyError } from '../lib/errors';
import { BODY_TYPES } from '../lib/pricing';
import { useProfiles, useTeams, useWorkstations } from '../lib/queries';
import { supabase } from '../lib/supabase';
import { formatDateTime, inZone, localToUtcIso, WEEKDAYS } from '../lib/time';
import { centsToInput, isTime, parseEuroToCents } from '../lib/validation';
import { colors, space } from '../theme';
import { Button, Card, Chip, ChipRow, Empty, ErrorState, Field, Loading, Notice, Screen, styles as ui, T, useToast } from './ui';
import { Alert } from './Dialog';

export type FieldType =
  | 'text'
  | 'multiline'
  | 'int'
  | 'money'
  | 'bool'
  | 'tribool'
  | 'color'
  | 'time'
  | 'date'
  | 'datetime'
  | 'select'
  | 'multiselect'
  | 'intlist'
  | 'textlist';

export type OptionSource = 'services' | 'teams' | 'workstations' | 'profiles' | 'body' | 'weekday' | { value: string | number; label: string }[];

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: OptionSource;
  nullable?: boolean; // select: optie "geen"
  nullLabel?: string;
  hint?: string;
  readOnly?: boolean;
  triLabels?: [string, string, string]; // [onbekend/ alle, ja, nee]
}

export interface TableConfig {
  table: string;
  title: string;
  pk: string;
  fields: FieldDef[];
  order: { col: string; asc?: boolean }[];
  describe: (row: Row, ctx: Ctx) => { title: string; subtitle?: string; inactive?: boolean };
  allowInsert?: boolean;
  allowDelete?: boolean;
  deleteHint?: string;
  ownerOnly?: boolean; // schrijven alleen door eigenaar
  defaults?: Row;
  intro?: string;
  queryFilter?: (q: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  invalidate?: string[][];
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Ctx {
  options: (src: OptionSource | undefined) => { value: string | number; label: string }[];
  label: (src: OptionSource | undefined, v: unknown) => string;
}

function useCtx(): Ctx {
  const teams = useTeams();
  const workstations = useWorkstations();
  const profiles = useProfiles();
  const services = useQuery({
    queryKey: ['catalog', 'services-options'],
    queryFn: async () => (await supabase.from('services').select('id, name, active').order('sort_order')).data ?? [],
  });
  return useMemo(() => {
    const options = (src: OptionSource | undefined) => {
      if (!src) return [];
      if (Array.isArray(src)) return src;
      switch (src) {
        case 'services':
          return (services.data ?? []).map((s) => ({ value: s.id, label: s.name + (s.active ? '' : ' (inactief)') }));
        case 'teams':
          return (teams.data ?? []).map((t) => ({ value: t.id, label: t.name }));
        case 'workstations':
          return (workstations.data ?? []).map((w) => ({ value: w.id, label: w.name }));
        case 'profiles':
          return (profiles.data ?? []).map((p) => ({ value: p.id, label: p.display_name }));
        case 'body':
          return BODY_TYPES.map((b) => ({ value: b.value, label: b.label }));
        case 'weekday':
          return WEEKDAYS.map((w, i) => ({ value: i + 1, label: w[0].toUpperCase() + w.slice(1) }));
      }
    };
    const label = (src: OptionSource | undefined, v: unknown) => options(src).find((o) => o.value === v)?.label ?? String(v ?? '');
    return { options, label };
  }, [services.data, teams.data, workstations.data, profiles.data]);
}

export function AdminTable({ config, canWrite }: { config: TableConfig; canWrite: boolean }) {
  const ctx = useCtx();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Row | null>(null);
  const [isNew, setIsNew] = useState(false);

  const q = useQuery({
    queryKey: ['admin', config.table],
    queryFn: async () => {
      let query = supabase.from(config.table).select('*');
      if (config.queryFilter) query = config.queryFilter(query);
      for (const o of config.order) query = query.order(o.col, { ascending: o.asc !== false, nullsFirst: true });
      const { data, error } = await query;
      if (error) throw error;
      return data as Row[];
    },
  });

  const onSaved = () => {
    qc.invalidateQueries({ queryKey: ['admin', config.table] });
    for (const k of config.invalidate ?? []) qc.invalidateQueries({ queryKey: k });
    setEditing(null);
  };

  return (
    <View style={{ flex: 1 }}>
      <Screen onRefresh={() => q.refetch()} refreshing={q.isRefetching}>
        {config.intro ? <Notice>{config.intro}</Notice> : null}
        {!canWrite ? <Notice kind="warning">Alleen-lezen: wijzigen kan alleen de eigenaar.</Notice> : null}
        {canWrite && config.allowInsert ? (
          <Button
            title="Toevoegen"
            icon="＋"
            onPress={() => {
              setIsNew(true);
              setEditing({ ...(config.defaults ?? {}) });
            }}
            style={{ marginBottom: space.md }}
          />
        ) : null}
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <Empty title="Nog niets ingesteld" />
        ) : (
          q.data.map((row) => {
            const d = config.describe(row, ctx);
            return (
              <Card
                key={String(row[config.pk])}
                onPress={() => {
                  setIsNew(false);
                  setEditing(row);
                }}
                style={d.inactive ? { opacity: 0.55 } : undefined}
              >
                <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>
                  {d.title}
                  {d.inactive ? ' · inactief' : ''}
                </Text>
                {d.subtitle ? <T.Muted style={{ marginTop: 2, fontSize: 14 }}>{d.subtitle}</T.Muted> : null}
              </Card>
            );
          })
        )}
      </Screen>
      <Modal visible={!!editing} animationType="none" presentationStyle="pageSheet" onRequestClose={() => setEditing(null)}>
        {editing ? (
          <RowEditor config={config} row={editing} isNew={isNew} canWrite={canWrite} ctx={ctx} onClose={() => setEditing(null)} onSaved={onSaved} />
        ) : null}
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------

function toText(f: FieldDef, v: unknown): string {
  if (v == null) return '';
  switch (f.type) {
    case 'money':
      return centsToInput(v as number);
    case 'time':
      return String(v).slice(0, 5);
    case 'intlist':
    case 'textlist':
      return (v as unknown[]).join(', ');
    case 'datetime':
      return inZone(String(v)).toFormat('yyyy-MM-dd HH:mm');
    default:
      return String(v);
  }
}

function parseField(f: FieldDef, text: string): { value: unknown; error?: string } {
  const t = text.trim();
  switch (f.type) {
    case 'int': {
      if (!t) return { value: null };
      return /^-?\d+$/.test(t) ? { value: parseInt(t, 10) } : { value: null, error: 'Geheel getal verwacht' };
    }
    case 'money': {
      const c = parseEuroToCents(t);
      return c != null && Number.isNaN(c) ? { value: null, error: 'Ongeldig bedrag' } : { value: c };
    }
    case 'time':
      if (!t) return { value: null };
      return isTime(t) ? { value: t } : { value: null, error: 'Formaat UU:MM' };
    case 'date':
      if (!t) return { value: null };
      return /^\d{4}-\d{2}-\d{2}$/.test(t) ? { value: t } : { value: null, error: 'Formaat JJJJ-MM-DD' };
    case 'datetime': {
      if (!t) return { value: null };
      const m = t.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/);
      if (!m) return { value: null, error: 'Formaat JJJJ-MM-DD UU:MM' };
      try {
        return { value: localToUtcIso(m[1], m[2]) };
      } catch {
        return { value: null, error: 'Ongeldige datum/tijd' };
      }
    }
    case 'intlist': {
      if (!t) return { value: null };
      if (/^(geen|0)$/i.test(t)) return { value: [] };
      const parts = t.split(/[,\s]+/).filter(Boolean);
      if (parts.some((p) => !/^\d+$/.test(p))) return { value: null, error: 'Getallen gescheiden door komma’s' };
      return { value: parts.map(Number) };
    }
    case 'textlist': {
      if (!t) return { value: f.nullable ? null : [] };
      return { value: t.split(',').map((s) => s.trim()).filter(Boolean) };
    }
    case 'color':
      return /^#[0-9A-Fa-f]{6}$/.test(t) ? { value: t.toUpperCase() } : { value: null, error: 'Kleur als #RRGGBB' };
    default:
      return { value: t === '' ? null : t };
  }
}

const TEXT_TYPES: FieldType[] = ['text', 'multiline', 'int', 'money', 'time', 'date', 'datetime', 'intlist', 'textlist', 'color'];
const PALETTE = ['#3B82F6', '#F59E0B', '#D946EF', '#22C55E', '#EF4444', '#14B8A6', '#F97316', '#8B5CF6', '#E5E7EB'];

function RowEditor({
  config,
  row,
  isNew,
  canWrite,
  ctx,
  onClose,
  onSaved,
}: {
  config: TableConfig;
  row: Row;
  isNew: boolean;
  canWrite: boolean;
  ctx: Ctx;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<Row>(() => ({ ...row }));
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(config.fields.filter((f) => TEXT_TYPES.includes(f.type)).map((f) => [f.key, toText(f, row[f.key])])),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const out: Row = {};
    const errs: Record<string, string> = {};
    for (const f of config.fields) {
      if (f.readOnly && !isNew) continue;
      let v: unknown;
      if (TEXT_TYPES.includes(f.type)) {
        const r = parseField(f, texts[f.key] ?? '');
        if (r.error) errs[f.key] = r.error;
        v = r.value;
      } else {
        v = values[f.key] ?? (f.type === 'bool' ? false : f.type === 'multiselect' && !f.nullable ? [] : null);
      }
      if (f.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) errs[f.key] = 'Verplicht';
      out[f.key] = v;
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setError(null);
    const res = isNew
      ? await supabase.from(config.table).insert(out)
      : await supabase.from(config.table).update(out).eq(config.pk, row[config.pk]).select();
    setBusy(false);
    if (res.error) return setError(toFriendlyError(res.error).message);
    if (!isNew && Array.isArray(res.data) && res.data.length === 0) return setError('Niet opgeslagen: geen rechten om dit te wijzigen.');
    toast('Opgeslagen');
    onSaved();
  };

  const remove = () =>
    Alert.alert('Verwijderen?', config.deleteHint ?? 'Bestaande afspraken behouden hun vastgelegde gegevens.', [
      { text: 'Annuleren', style: 'cancel' },
      {
        text: 'Verwijderen',
        style: 'destructive',
        onPress: async () => {
          const { error: err } = await supabase.from(config.table).delete().eq(config.pk, row[config.pk]);
          if (err) {
            const msg = /foreign key|violates/i.test(err.message)
              ? 'Dit wordt nog gebruikt in afspraken. Zet het op inactief in plaats van verwijderen.'
              : toFriendlyError(err).message;
            return Alert.alert('Niet verwijderd', msg);
          }
          toast('Verwijderd');
          onSaved();
        },
      },
    ]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space.lg }}>
        <T.H2>{isNew ? 'Toevoegen' : canWrite ? 'Bewerken' : 'Details'}</T.H2>
        <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Sluiten">
          <Text style={{ color: colors.text, fontSize: 17 }}>Sluiten</Text>
        </Pressable>
      </View>
      <Screen
        edges={[]}
        footer={
          canWrite ? (
            <View style={{ gap: space.sm }}>
              <Button title="Opslaan" onPress={save} loading={busy} big />
              {!isNew && config.allowDelete ? <Button title="Verwijderen" variant="ghost" onPress={remove} /> : null}
            </View>
          ) : undefined
        }
      >
        {config.fields.map((f) => {
          const disabled = !canWrite || (f.readOnly && !isNew);
          if (TEXT_TYPES.includes(f.type)) {
            return (
              <View key={f.key}>
                <Field
                  label={f.label + (f.required ? ' *' : '')}
                  value={texts[f.key] ?? ''}
                  onChangeText={(t) => setTexts({ ...texts, [f.key]: t })}
                  editable={!disabled}
                  multiline={f.type === 'multiline'}
                  keyboardType={f.type === 'int' ? 'number-pad' : f.type === 'money' ? 'decimal-pad' : 'default'}
                  autoCapitalize={f.type === 'color' ? 'characters' : 'sentences'}
                  error={errors[f.key]}
                  hint={f.hint ?? (f.type === 'money' ? 'Leeg = nog te bepalen' : f.type === 'datetime' ? 'JJJJ-MM-DD UU:MM (Nederlandse tijd)' : undefined)}
                />
                {f.type === 'color' ? (
                  <ChipRow>
                    {PALETTE.map((c) => (
                      <Chip key={c} label={c} color={c} selected={texts[f.key]?.toUpperCase() === c} onPress={() => !disabled && setTexts({ ...texts, [f.key]: c })} />
                    ))}
                  </ChipRow>
                ) : null}
              </View>
            );
          }
          if (f.type === 'bool') {
            return (
              <View key={f.key} style={[ui.row, { justifyContent: 'space-between' }]}>
                <Text style={{ color: colors.text, fontSize: 16, flex: 1 }}>{f.label}</Text>
                <Switch value={!!values[f.key]} onValueChange={(v) => setValues({ ...values, [f.key]: v })} disabled={disabled} accessibilityLabel={f.label} />
              </View>
            );
          }
          const labelEl = <Text style={[ui.label, { marginTop: space.md }]}>{f.label + (f.required ? ' *' : '')}</Text>;
          if (f.type === 'tribool') {
            const [nullL, yesL, noL] = f.triLabels ?? ['Onbekend', 'Ja', 'Nee'];
            return (
              <View key={f.key}>
                {labelEl}
                <ChipRow>
                  {([
                    [null, nullL],
                    [true, yesL],
                    [false, noL],
                  ] as const).map(([v, l]) => (
                    <Chip key={l} label={l} selected={values[f.key] === v || (v === null && values[f.key] == null)} onPress={() => !disabled && setValues({ ...values, [f.key]: v })} />
                  ))}
                </ChipRow>
              </View>
            );
          }
          const opts = ctx.options(f.options);
          if (f.type === 'select') {
            return (
              <View key={f.key}>
                {labelEl}
                <ChipRow>
                  {f.nullable ? <Chip label={f.nullLabel ?? 'Geen'} selected={values[f.key] == null} onPress={() => !disabled && setValues({ ...values, [f.key]: null })} /> : null}
                  {opts.map((o) => (
                    <Chip key={String(o.value)} label={o.label} selected={values[f.key] === o.value} onPress={() => !disabled && setValues({ ...values, [f.key]: o.value })} />
                  ))}
                </ChipRow>
                {errors[f.key] ? <Text style={ui.error}>{errors[f.key]}</Text> : null}
              </View>
            );
          }
          // multiselect
          const cur: unknown[] = values[f.key] ?? [];
          return (
            <View key={f.key}>
              {labelEl}
              <ChipRow>
                {f.nullable ? <Chip label={f.nullLabel ?? 'Alle'} selected={values[f.key] == null} onPress={() => !disabled && setValues({ ...values, [f.key]: null })} /> : null}
                {opts.map((o) => (
                  <Chip
                    key={String(o.value)}
                    label={o.label}
                    selected={cur.includes(o.value)}
                    onPress={() =>
                      !disabled && setValues({ ...values, [f.key]: cur.includes(o.value) ? cur.filter((x) => x !== o.value) : [...cur, o.value] })
                    }
                  />
                ))}
              </ChipRow>
              {f.hint ? <Text style={ui.hint}>{f.hint}</Text> : null}
              {errors[f.key] ? <Text style={ui.error}>{errors[f.key]}</Text> : null}
            </View>
          );
        })}
        {error ? <Notice kind="danger">{error}</Notice> : null}
        {!isNew && row.created_at ? <T.Muted style={{ fontSize: 12, marginTop: space.lg }}>Aangemaakt {formatDateTime(row.created_at)}</T.Muted> : null}
      </Screen>
    </SafeAreaView>
  );
}
