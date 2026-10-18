import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Alert } from '../../../components/Dialog';
import { UNASSIGNED_COLOR } from '../../../components/planning';
import { Button, Card, Chip, ChipRow, ErrorState, Loading, Screen, Section, T, useAccent, useToast } from '../../../components/ui';
import { toFriendlyError } from '../../../lib/errors';
import { formatEuro } from '../../../lib/pricing';
import { isWeb } from '../../../lib/pwa';
import { useTeams } from '../../../lib/queries';
import { bucketLabel, buildAppointmentsCsv, downloadTextFile, Period, periodRange, shiftAnchor, useStats } from '../../../lib/stats';
import { todayIsoDate } from '../../../lib/time';
import { colors, font, radius, space } from '../../../theme';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'maand', label: 'Maand' },
  { value: 'jaar', label: 'Jaar' },
  { value: 'alles', label: 'Alles' },
];

export default function Overview() {
  const accent = useAccent();
  const toast = useToast();
  const [period, setPeriod] = useState<Period>('week');
  const [anchor, setAnchor] = useState(todayIsoDate());
  const [team, setTeam] = useState<'alle' | 'geen' | string>('alle');
  const [exporting, setExporting] = useState(false);
  const teams = useTeams();
  const range = useMemo(() => periodRange(period, anchor), [period, anchor]);
  const stats = useStats(range, team);
  const s = stats.data;
  const maxBucket = Math.max(1, ...(s?.buckets ?? []).map((b) => b.planned));
  const teamNames = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t.name])), [teams.data]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { csv, count } = await buildAppointmentsCsv(range, teamNames);
      const name = `afspraken-${range.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.csv`;
      downloadTextFile(name, csv);
      toast(`${count} afspraken geëxporteerd`);
    } catch (e) {
      const f = toFriendlyError(e);
      Alert.alert(f.title, f.message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen onRefresh={() => stats.refetch()} refreshing={stats.isRefetching}>
      <ChipRow>
        {PERIODS.map((p) => (
          <Chip key={p.value} label={p.label} selected={period === p.value} onPress={() => setPeriod(p.value)} />
        ))}
      </ChipRow>

      <View style={st.navRow}>
        {period !== 'alles' ? (
          <Pressable onPress={() => setAnchor(shiftAnchor(period, anchor, -1))} hitSlop={12} accessibilityLabel="Vorige periode" style={st.navBtn}>
            <Text style={st.navTxt}>‹</Text>
          </Pressable>
        ) : null}
        <Text style={st.periodLabel} numberOfLines={1}>
          {range.label}
        </Text>
        {period !== 'alles' ? (
          <>
            <Pressable onPress={() => setAnchor(shiftAnchor(period, anchor, 1))} hitSlop={12} accessibilityLabel="Volgende periode" style={st.navBtn}>
              <Text style={st.navTxt}>›</Text>
            </Pressable>
            <Pressable onPress={() => setAnchor(todayIsoDate())} accessibilityRole="button" style={[st.nowBtn, { borderColor: accent }]}>
              <Text style={{ color: accent, fontWeight: '700' }}>Nu</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      <ChipRow scroll>
        <Chip label="Alle partijen" selected={team === 'alle'} onPress={() => setTeam('alle')} />
        {(teams.data ?? []).map((t) => (
          <Chip key={t.id} label={t.name} color={t.color} selected={team === t.id} onPress={() => setTeam(t.id)} />
        ))}
        <Chip label="Niet toegewezen" color={UNASSIGNED_COLOR} selected={team === 'geen'} onPress={() => setTeam('geen')} />
      </ChipRow>

      {stats.isLoading ? (
        <Loading />
      ) : stats.error || !s ? (
        <ErrorState error={stats.error} onRetry={() => stats.refetch()} />
      ) : (
        <>
          <View style={[st.hero, { borderColor: accent }]}>
            <Text style={st.heroNum}>{s.planned}</Text>
            <Text style={st.heroLabel}>{s.planned === 1 ? 'auto gepland' : "auto's gepland"}</Text>
            <Text style={st.heroSub}>
              {s.completed} afgerond · {s.upcoming} nog te komen
            </Text>
          </View>

          <View style={st.tiles}>
            <Tile label="Geplande omzet" value={formatEuro(s.revenue_planned_cents, '€ 0')} />
            <Tile label="Omzet afgerond" value={formatEuro(s.revenue_completed_cents, '€ 0')} />
            <Tile label="Geannuleerd" value={String(s.cancelled)} />
            <Tile label="Niet verschenen" value={String(s.no_show)} />
          </View>
          {s.price_unknown ? (
            <T.Muted style={{ fontSize: 13, marginTop: space.xs }}>
              {s.price_unknown} {s.price_unknown === 1 ? 'afspraak heeft' : 'afspraken hebben'} nog geen vaste prijs en {s.price_unknown === 1 ? 'telt' : 'tellen'} niet mee in de omzet.
            </T.Muted>
          ) : null}

          {s.buckets.length > 1 ? (
            <Section title={period === 'week' ? 'Per dag' : period === 'maand' ? 'Per dag' : 'Per maand'}>
              <Card>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ minWidth: '100%' }}>
                  <View style={st.chart}>
                    {s.buckets.map((b) => (
                      <View key={b.start} style={[st.barCol, s.buckets.length > 14 ? { width: 22 } : { flex: 1 }]}>
                        <Text style={st.barValue}>{b.planned || ''}</Text>
                        <View style={st.barTrack}>
                          <View style={[st.bar, { height: `${(b.planned / maxBucket) * 100}%`, backgroundColor: accent }]} />
                        </View>
                        <Text style={st.barLabel} numberOfLines={1}>
                          {bucketLabel(b.start, range.bucket, period)}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </Card>
            </Section>
          ) : null}

          <Section title="Per uitvoerende partij">
            <Card>
              {s.by_team.length === 0 ? (
                <T.Muted>Geen afspraken in deze periode.</T.Muted>
              ) : (
                s.by_team.map((t) => (
                  <View key={t.team_id ?? 'geen'} style={st.teamRow}>
                    <View style={[st.swatch, { backgroundColor: t.color ?? UNASSIGNED_COLOR }]} />
                    <Text style={st.teamName} numberOfLines={1}>
                      {t.name}
                    </Text>
                    <Text style={st.teamCount}>{t.count}</Text>
                    <Text style={st.teamRev}>{formatEuro(t.revenue_cents, '€ 0')}</Text>
                  </View>
                ))
              )}
            </Card>
          </Section>

          {s.by_service.length ? (
            <Section title="Behandelingen">
              <Card>
                {s.by_service.map((x) => (
                  <View key={x.name} style={st.teamRow}>
                    <Text style={st.teamName} numberOfLines={1}>
                      {x.name}
                    </Text>
                    <Text style={st.teamCount}>{x.count}×</Text>
                  </View>
                ))}
              </Card>
            </Section>
          ) : null}

          {isWeb ? (
            <Section title="Exporteren">
              <Button title="Download afspraken (Excel/CSV)" variant="secondary" onPress={exportCsv} loading={exporting} />
              <T.Muted style={{ fontSize: 13, marginTop: space.xs }}>Alle afspraken van "{range.label}" (alle partijen), te openen in Excel of Numbers.</T.Muted>
            </Section>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <View style={st.tile}>
      <Text style={st.tileValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={st.tileLabel}>{label}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  navRow: { flexDirection: 'row', alignItems: 'center', marginVertical: space.md },
  navBtn: { paddingHorizontal: space.sm },
  navTxt: { color: colors.text, fontSize: 30, lineHeight: 34 },
  periodLabel: { flex: 1, color: colors.text, fontSize: font.large, fontWeight: '800', textAlign: 'center' },
  nowBtn: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 6, marginLeft: space.sm },
  hero: { marginTop: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, padding: space.xl, alignItems: 'center' },
  heroNum: { color: colors.text, fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'], lineHeight: 62 },
  heroLabel: { color: colors.text, fontSize: font.large, fontWeight: '700' },
  heroSub: { color: colors.textDim, marginTop: space.xs },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.md },
  tile: { flexGrow: 1, flexBasis: '45%', backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: space.md },
  tileValue: { color: colors.text, fontSize: font.title, fontWeight: '800', fontVariant: ['tabular-nums'] },
  tileLabel: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', height: 170, gap: 4, flex: 1 },
  barCol: { alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
  barValue: { color: colors.textDim, fontSize: 11, marginBottom: 2, fontVariant: ['tabular-nums'] },
  barTrack: { width: '70%', height: 120, justifyContent: 'flex-end' },
  bar: { width: '100%', borderTopLeftRadius: 4, borderTopRightRadius: 4, minHeight: 0 },
  barLabel: { color: colors.textFaint, fontSize: 11, marginTop: 4 },
  teamRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  teamName: { color: colors.text, fontSize: font.body, flex: 1 },
  teamCount: { color: colors.text, fontWeight: '800', fontSize: font.body, fontVariant: ['tabular-nums'], minWidth: 36, textAlign: 'right' },
  teamRev: { color: colors.textDim, fontSize: 14, minWidth: 80, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
