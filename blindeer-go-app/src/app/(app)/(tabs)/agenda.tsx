import { router } from 'expo-router';
import { DateTime } from 'luxon';
import React, { useMemo, useState } from 'react';
import { GestureResponderEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppointmentCard, MonthGrid, UNASSIGNED_COLOR, vehicleLabel } from '../../../components/planning';
import { Button, Chip, ChipRow, Empty, ErrorState, Loading, Notice, useAccent } from '../../../components/ui';
import { Schedule, useAppointmentsRange, useBlocksRange, useSchedule, useSettings, useTeams } from '../../../lib/queries';
import {
  addDays,
  formatDateLong,
  formatDateShort,
  formatTime,
  getBusinessZone,
  isoDateOf,
  isoWeekday,
  minutesOfDay,
  minutesToTime,
  startOfWeek,
  timeToMinutes,
  todayIsoDate,
} from '../../../lib/time';
import { Appointment, AppointmentStatus, Block, STATUSES, Team } from '../../../lib/types';
import { colors, font, onColor, radius, space, statusColors, withAlpha } from '../../../theme';

type Mode = 'dag' | 'week' | 'maand';
type TeamFilter = 'alle' | 'geen' | string;

const PX_PER_MIN = 1.3;

function dayWindow(date: string, schedule: Schedule | undefined) {
  const o = schedule?.overrides.find((x) => x.date === date);
  const h = schedule?.hours.find((x) => x.weekday === isoWeekday(date));
  const src = o ?? h;
  const closed = !src || src.is_closed;
  const open = closed ? null : timeToMinutes(src!.open_time);
  const close = closed ? null : timeToMinutes(src!.close_time);
  const breaks =
    o?.ignore_breaks || closed
      ? []
      : (schedule?.breaks ?? []).filter((b) => b.active && (b.weekday == null || b.weekday === isoWeekday(date)));
  return { closed, open, close, breaks, note: o?.note ?? null };
}

export default function Agenda() {
  const accent = useAccent();
  const [mode, setMode] = useState<Mode>('dag');
  const [date, setDate] = useState(todayIsoDate());
  const [month, setMonth] = useState(DateTime.fromISO(todayIsoDate()).startOf('month').toISODate()!);
  const [teamFilter, setTeamFilter] = useState<TeamFilter>('alle');
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus[]>([]);
  const [showFilters, setShowFilters] = useState(false);

  const range = useMemo(() => {
    if (mode === 'dag') return { from: date, to: addDays(date, 1) };
    if (mode === 'week') {
      const s = startOfWeek(date);
      return { from: s, to: addDays(s, 7) };
    }
    const s = DateTime.fromISO(month).startOf('month').startOf('week').toISODate()!;
    return { from: s, to: addDays(s, 42) };
  }, [mode, date, month]);

  const appts = useAppointmentsRange(range.from, range.to);
  const blocks = useBlocksRange(range.from, range.to);
  const teams = useTeams();
  const schedule = useSchedule();
  const settings = useSettings();
  const teamById = useMemo(() => new Map((teams.data ?? []).map((t) => [t.id, t])), [teams.data]);

  const filtered = useMemo(
    () =>
      (appts.data ?? []).filter((a) => {
        if (teamFilter === 'geen' && a.team_id) return false;
        if (teamFilter !== 'alle' && teamFilter !== 'geen' && a.team_id !== teamFilter) return false;
        if (statusFilter.length && !statusFilter.includes(a.status)) return false;
        return true;
      }),
    [appts.data, teamFilter, statusFilter],
  );

  const move = (delta: number) => {
    if (mode === 'dag') setDate(addDays(date, delta));
    else if (mode === 'week') setDate(addDays(date, 7 * delta));
    else setMonth(DateTime.fromISO(month).plus({ months: delta }).toISODate()!);
  };
  const goToday = () => {
    const t = todayIsoDate();
    setDate(t);
    setMonth(DateTime.fromISO(t).startOf('month').toISODate()!);
  };

  const title =
    mode === 'dag'
      ? formatDateLong(date)
      : mode === 'week'
        ? `Week ${DateTime.fromISO(date).weekNumber} · ${formatDateShort(startOfWeek(date))} t/m ${formatDateShort(addDays(startOfWeek(date), 6))}`
        : DateTime.fromISO(month).setLocale('nl').toFormat('LLLL yyyy').replace(/^./, (c) => c.toUpperCase());

  const activeFilterCount = (teamFilter !== 'alle' ? 1 : 0) + (statusFilter.length ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={st.toolbar}>
        <ChipRow>
          {(['dag', 'week', 'maand'] as Mode[]).map((m) => (
            <Chip key={m} label={m[0].toUpperCase() + m.slice(1)} selected={mode === m} onPress={() => setMode(m)} />
          ))}
          <Chip label={`Filters${activeFilterCount ? ` (${activeFilterCount})` : ''}`} selected={showFilters} onPress={() => setShowFilters(!showFilters)} />
        </ChipRow>
        <View style={st.navRow}>
          <Pressable onPress={() => move(-1)} hitSlop={10} accessibilityLabel="Vorige" style={st.navBtn}>
            <Text style={st.navTxt}>‹</Text>
          </Pressable>
          <Text style={st.title} numberOfLines={1}>
            {title}
          </Text>
          <Pressable onPress={() => move(1)} hitSlop={10} accessibilityLabel="Volgende" style={st.navBtn}>
            <Text style={st.navTxt}>›</Text>
          </Pressable>
          <Pressable onPress={goToday} accessibilityRole="button" style={[st.todayBtn, { borderColor: accent }]}>
            <Text style={{ color: accent, fontWeight: '700' }}>Vandaag</Text>
          </Pressable>
        </View>
        {showFilters ? (
          <View style={{ gap: space.sm, marginTop: space.sm }}>
            <ChipRow scroll>
              <Chip label="Alle partijen" selected={teamFilter === 'alle'} onPress={() => setTeamFilter('alle')} />
              {(teams.data ?? []).map((t) => (
                <Chip key={t.id} label={t.name} color={t.color} selected={teamFilter === t.id} onPress={() => setTeamFilter(t.id)} />
              ))}
              <Chip label="Niet toegewezen" color={UNASSIGNED_COLOR} selected={teamFilter === 'geen'} onPress={() => setTeamFilter('geen')} />
            </ChipRow>
            <ChipRow scroll>
              <Chip label="Alle statussen" selected={!statusFilter.length} onPress={() => setStatusFilter([])} />
              {STATUSES.map((s) => (
                <Chip
                  key={s.value}
                  label={s.label}
                  color={statusColors[s.value]}
                  selected={statusFilter.includes(s.value)}
                  onPress={() =>
                    setStatusFilter(statusFilter.includes(s.value) ? statusFilter.filter((x) => x !== s.value) : [...statusFilter, s.value])
                  }
                />
              ))}
            </ChipRow>
          </View>
        ) : null}
      </View>

      {appts.isLoading || schedule.isLoading ? (
        <Loading />
      ) : appts.error ? (
        <ErrorState error={appts.error} onRetry={() => appts.refetch()} />
      ) : mode === 'dag' ? (
        <DayTimeline
          date={date}
          appts={filtered}
          blocks={blocks.data ?? []}
          schedule={schedule.data}
          teamById={teamById}
          slotMin={settings.data?.slot_interval_min ?? 15}
          accent={accent}
        />
      ) : mode === 'week' ? (
        <WeekList start={startOfWeek(date)} appts={filtered} blocks={blocks.data ?? []} schedule={schedule.data} teamById={teamById} onOpenDay={(d) => { setDate(d); setMode('dag'); }} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.lg }}>
          <MonthGrid
            month={month}
            selected={date}
            accent={accent}
            onChangeMonth={setMonth}
            counts={filtered.reduce<Record<string, number>>((acc, a) => {
              if (a.status === 'geannuleerd') return acc;
              const d = isoDateOf(a.starts_at);
              acc[d] = (acc[d] ?? 0) + 1;
              return acc;
            }, {})}
            onSelect={(d) => {
              setDate(d);
              setMode('dag');
            }}
          />
          <Notice>Tik op een dag om de dagplanning te openen. Getallen = aantal afspraken (excl. geannuleerd).</Notice>
        </ScrollView>
      )}

      {mode !== 'maand' ? (
        <Pressable
          onPress={() => router.push({ pathname: '/afspraak/nieuw', params: { date } })}
          accessibilityRole="button"
          accessibilityLabel="Afspraak toevoegen"
          style={({ pressed }) => [st.fab, { backgroundColor: accent }, pressed && { opacity: 0.8 }]}
        >
          <Text style={[st.fabTxt, { color: onColor(accent) }]}>＋</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function DayTimeline({
  date,
  appts,
  blocks,
  schedule,
  teamById,
  slotMin,
  accent,
}: {
  date: string;
  appts: Appointment[];
  blocks: Block[];
  schedule: Schedule | undefined;
  teamById: Map<string, Team>;
  slotMin: number;
  accent: string;
}) {
  const w = dayWindow(date, schedule);
  const zone = getBusinessZone();
  const dayStart = DateTime.fromISO(date, { zone }).startOf('day');
  const toMin = (iso: string) => {
    const diff = DateTime.fromISO(iso).setZone(zone).diff(dayStart, 'minutes').minutes;
    return Math.max(0, Math.min(24 * 60, diff));
  };
  const apptMins = appts.map((a) => [toMin(a.starts_at), toMin(a.ends_at)]);
  let startMin = w.open ?? 9 * 60;
  let endMin = w.close ?? 18 * 60;
  for (const [s, e] of apptMins) {
    startMin = Math.min(startMin, s);
    endMin = Math.max(endMin, e);
  }
  startMin = Math.floor(startMin / 60) * 60;
  endMin = Math.ceil(endMin / 60) * 60;
  const height = (endMin - startMin) * PX_PER_MIN;
  const y = (m: number) => (m - startMin) * PX_PER_MIN;

  // Overlappende afspraken naast elkaar (banen).
  const sorted = [...appts].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const lanes: number[] = [];
  const laneOf = new Map<string, number>();
  for (const a of sorted) {
    const s = toMin(a.starts_at);
    let lane = lanes.findIndex((end) => end <= s);
    if (lane === -1) {
      lane = lanes.length;
      lanes.push(0);
    }
    lanes[lane] = toMin(a.ends_at) + a.buffer_min;
    laneOf.set(a.id, lane);
  }
  const laneCount = Math.max(1, lanes.length);

  const onBackgroundPress = (e: GestureResponderEvent) => {
    const m = startMin + e.nativeEvent.locationY / PX_PER_MIN;
    const rounded = Math.floor(m / slotMin) * slotMin;
    router.push({ pathname: '/afspraak/nieuw', params: { date, time: minutesToTime(rounded) } });
  };

  const dayBlocks = blocks.filter((b) => isoDateOf(b.starts_at) <= date && isoDateOf(b.ends_at) >= date);

  return (
    <ScrollView contentContainerStyle={{ padding: space.md, paddingBottom: 120 }}>
      {w.closed ? <Notice kind="warning">Gesloten{w.note ? `: ${w.note}` : ''}. Afspraken zijn op deze dag niet mogelijk.</Notice> : null}
      {!w.closed && w.note ? <Notice>{w.note}</Notice> : null}
      {appts.length === 0 && !w.closed ? <Text style={st.hint}>Geen afspraken. Tik op een vrij tijdstip om een afspraak te plannen.</Text> : null}
      <View style={{ flexDirection: 'row' }}>
        <View style={{ width: 48, height }}>
          {Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => (
            <Text key={i} style={[st.hourLabel, { top: i * 60 * PX_PER_MIN - 8 }]}>
              {minutesToTime(startMin + i * 60)}
            </Text>
          ))}
        </View>
        <Pressable style={{ flex: 1, height }} onPress={onBackgroundPress} accessibilityLabel="Vrij tijdstip kiezen voor een nieuwe afspraak">
          {/* Gesloten tijd */}
          {w.open != null && w.open > startMin ? <View style={[st.closed, { top: 0, height: y(w.open) }]} /> : null}
          {w.close != null && w.close < endMin ? <View style={[st.closed, { top: y(w.close), height: y(endMin) - y(w.close) }]} /> : null}
          {w.closed ? <View style={[st.closed, { top: 0, height }]} /> : null}
          {Array.from({ length: (endMin - startMin) / 60 + 1 }, (_, i) => (
            <View key={i} style={[st.hourLine, { top: i * 60 * PX_PER_MIN }]} />
          ))}
          {w.breaks.map((b) => {
            const s = timeToMinutes(b.start_time)!;
            const e = timeToMinutes(b.end_time)!;
            return (
              <View key={b.id} style={[st.breakBox, { top: y(s), height: (e - s) * PX_PER_MIN }]}>
                <Text style={st.breakTxt}>
                  {b.label} {b.start_time.slice(0, 5)}–{b.end_time.slice(0, 5)}
                </Text>
              </View>
            );
          })}
          {dayBlocks.map((b) => {
            const s = toMin(b.starts_at);
            const e = isoDateOf(b.ends_at) > date ? 24 * 60 : toMin(b.ends_at);
            const scope = b.team_id ? teamById.get(b.team_id)?.name : b.profile_id || b.workstation_id ? 'deel van team' : 'heel bedrijf';
            return (
              <View key={b.id} style={[st.blockBox, { top: y(Math.max(s, startMin)), height: Math.max(24, (Math.min(e, endMin) - Math.max(s, startMin)) * PX_PER_MIN) }]}>
                <Text style={st.blockTxt} numberOfLines={2}>
                  {b.kind === 'afwezigheid' ? 'Afwezig' : 'Blokkade'} ({scope}): {b.reason}
                </Text>
              </View>
            );
          })}
          {sorted.map((a) => {
            const s = toMin(a.starts_at);
            const e = toMin(a.ends_at);
            const team = teamById.get(a.team_id ?? '');
            const color = team?.color ?? UNASSIGNED_COLOR;
            const lane = laneOf.get(a.id) ?? 0;
            const inactive = a.status === 'geannuleerd' || a.status === 'niet_verschenen';
            return (
              <React.Fragment key={a.id}>
                {a.buffer_min > 0 && !inactive ? (
                  <View
                    style={[
                      st.buffer,
                      { top: y(e), height: a.buffer_min * PX_PER_MIN, left: `${(lane / laneCount) * 100}%`, width: `${100 / laneCount}%` },
                    ]}
                  />
                ) : null}
                <Pressable
                  onPress={() => router.push(`/afspraak/${a.id}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatTime(a.starts_at)} ${a.customer_name}, ${team?.name ?? 'niet toegewezen'}`}
                  style={[
                    st.event,
                    {
                      top: y(s),
                      height: Math.max(28, (e - s) * PX_PER_MIN - 2),
                      left: `${(lane / laneCount) * 100}%`,
                      width: `${100 / laneCount}%`,
                      backgroundColor: withAlpha(color, inactive ? 0.12 : 0.28),
                      borderLeftColor: color,
                    },
                  ]}
                >
                  <Text style={[st.eventTime, inactive && { textDecorationLine: 'line-through' }]} numberOfLines={1}>
                    {formatTime(a.starts_at)}–{formatTime(a.ends_at)} · {team?.name ?? 'Niet toegewezen'}
                  </Text>
                  <Text style={st.eventTitle} numberOfLines={1}>
                    {vehicleLabel(a.vehicle)}
                  </Text>
                  <Text style={st.eventSub} numberOfLines={1}>
                    {a.customer_name} · <Text style={{ color: statusColors[a.status] }}>{STATUSES.find((x) => x.value === a.status)?.label}</Text>
                  </Text>
                </Pressable>
              </React.Fragment>
            );
          })}
        </Pressable>
      </View>
    </ScrollView>
  );
}

function WeekList({
  start,
  appts,
  blocks,
  schedule,
  teamById,
  onOpenDay,
}: {
  start: string;
  appts: Appointment[];
  blocks: Block[];
  schedule: Schedule | undefined;
  teamById: Map<string, Team>;
  onOpenDay: (d: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const today = todayIsoDate();
  return (
    <ScrollView contentContainerStyle={{ padding: space.md, paddingBottom: 120 }}>
      {days.map((d) => {
        const list = appts.filter((a) => isoDateOf(a.starts_at) === d);
        const w = dayWindow(d, schedule);
        const dayBlocks = blocks.filter((b) => isoDateOf(b.starts_at) <= d && isoDateOf(b.ends_at) >= d);
        return (
          <View key={d} style={{ marginBottom: space.lg }}>
            <Pressable onPress={() => onOpenDay(d)} style={st.weekHeader} accessibilityRole="button" accessibilityLabel={`Open ${formatDateLong(d)}`}>
              <Text style={[st.weekDay, d === today && { color: colors.info }]}>{formatDateShort(d)}</Text>
              <Text style={st.weekMeta}>
                {w.closed ? 'Gesloten' : `${minutesToTime(w.open!)}–${minutesToTime(w.close!)}`} · {list.filter((a) => a.status !== 'geannuleerd').length} afspr. ›
              </Text>
            </Pressable>
            {dayBlocks.map((b) => (
              <Text key={b.id} style={st.weekBlock}>
                ⛔ {b.kind === 'afwezigheid' ? 'Afwezig' : 'Blokkade'} {formatTime(b.starts_at)}–{formatTime(b.ends_at)}: {b.reason}
              </Text>
            ))}
            {list.length === 0 ? (
              <Text style={st.hint}>Geen afspraken</Text>
            ) : (
              list.map((a) => <AppointmentCard key={a.id} a={a} team={teamById.get(a.team_id ?? '')} compact onPress={() => router.push(`/afspraak/${a.id}`)} />)
            )}
          </View>
        );
      })}
      {appts.length === 0 ? <Empty title="Rustige week" text="Geen afspraken die aan de filters voldoen." /> : null}
    </ScrollView>
  );
}

const st = StyleSheet.create({
  toolbar: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  navRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.sm },
  navBtn: { paddingHorizontal: space.sm },
  navTxt: { color: colors.text, fontSize: 30, lineHeight: 34 },
  title: { flex: 1, color: colors.text, fontSize: font.body, fontWeight: '700', textAlign: 'center' },
  todayBtn: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, marginLeft: space.sm },
  hourLabel: { position: 'absolute', color: colors.textFaint, fontSize: 12, width: 44 },
  hourLine: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  closed: { position: 'absolute', left: 0, right: 0, backgroundColor: '#07090C' },
  breakBox: { position: 'absolute', left: 0, right: 0, backgroundColor: colors.breakFill, borderWidth: 1, borderColor: colors.border, borderStyle: 'dashed', justifyContent: 'center', paddingLeft: 8 },
  breakTxt: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
  blockBox: { position: 'absolute', left: 0, right: 0, backgroundColor: colors.blockFill, borderLeftWidth: 4, borderLeftColor: colors.danger, padding: 4 },
  blockTxt: { color: '#FCA5A5', fontSize: 12, fontWeight: '600' },
  buffer: { position: 'absolute', backgroundColor: withAlpha('#94A3B8', 0.12) },
  event: { position: 'absolute', borderLeftWidth: 5, borderRadius: 6, padding: 4, paddingLeft: 6, overflow: 'hidden', borderWidth: 1, borderColor: colors.border },
  eventTime: { color: colors.text, fontSize: 12, fontWeight: '800' },
  eventTitle: { color: colors.text, fontSize: 13, fontWeight: '700' },
  eventSub: { color: colors.textDim, fontSize: 12 },
  hint: { color: colors.textFaint, marginVertical: space.sm },
  weekHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm, paddingVertical: 4 },
  weekDay: { color: colors.text, fontWeight: '800', fontSize: font.large },
  weekMeta: { color: colors.textDim, fontSize: 14 },
  weekBlock: { color: '#FCA5A5', fontSize: 14, marginBottom: 6 },
  fab: { position: 'absolute', right: 20, bottom: 24, width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  fabTxt: { fontSize: 30, fontWeight: '700' },
});
