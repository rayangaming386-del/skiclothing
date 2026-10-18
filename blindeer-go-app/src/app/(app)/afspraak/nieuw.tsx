// Afspraak aanmaken én bewerken/verplaatsen (met ?id=...).
// Eén scherm met inklapbare blokken: klant → auto → behandeling(en) → wanneer/wie → opmerkingen.
// Onderaan staan altijd prijs, tijd en de knop Opslaan.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { MonthGrid, TeamBadge, UNASSIGNED_COLOR } from '../../../components/planning';
import { Button, Card, Chip, ChipRow, Field, Loading, Notice, PromptModal, Row, Screen, Section, styles as ui, T, useAccent, useToast } from '../../../components/ui';
import { draftToRow, emptyVehicle, rowToDraft, VehicleDraft, VehicleForm } from '../../../components/VehicleForm';
import { useAuth } from '../../../lib/auth';
import { FriendlyError, toFriendlyError } from '../../../lib/errors';
import { computeQuote, formatDuration, formatEuro, LineSelection, quoteToItems, VehicleInput } from '../../../lib/pricing';
import {
  fetchAvailableStarts,
  fetchBookingProblems,
  qk,
  useAppointment,
  useCatalog,
  useCustomer,
  useCustomerSearch,
  useProfiles,
  useSaveAppointment,
  useSettings,
  useTeams,
  useWorkstations,
} from '../../../lib/queries';
import { supabase } from '../../../lib/supabase';
import { addDays, formatDateLong, formatDateShort, formatTime, isoDateOf, localToUtcIso, todayIsoDate } from '../../../lib/time';
import { Appointment, AppointmentStatus, STATUSES } from '../../../lib/types';
import { centsToInput, isTime, parseEuroToCents, parseIntOrNull } from '../../../lib/validation';
import { colors, onColor, space, statusColors } from '../../../theme';
import { Alert } from '../../../components/Dialog';

interface CustomerSel {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export default function AppointmentEditor() {
  const params = useLocalSearchParams<{ id?: string; date?: string; time?: string; customerId?: string; vehicleId?: string; stap?: string }>();
  const editId = params.id;
  const isEdit = !!editId;
  const accent = useAccent();
  const toast = useToast();
  const qc = useQueryClient();
  const { isOwner, profile } = useAuth();

  const settings = useSettings();
  const catalog = useCatalog();
  const teams = useTeams();
  const profiles = useProfiles();
  const workstations = useWorkstations();
  const existing = useAppointment(editId);
  const save = useSaveAppointment();

  const requestId = useRef(Crypto.randomUUID());
  const [open, setOpen] = useState<BlockKey | null>(isEdit ? null : 'klant');
  const [showMore, setShowMore] = useState(false);
  const [customer, setCustomer] = useState<CustomerSel | null>(null);
  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState<VehicleDraft | null>(null);
  const [vehicleSkipped, setVehicleSkipped] = useState(false);
  const [selections, setSelections] = useState<LineSelection[]>([]);
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [bufferMin, setBufferMin] = useState<number | null>(null);
  const [date, setDate] = useState(params.date ?? todayIsoDate());
  const [time, setTime] = useState<string | null>(params.time ?? null);
  const [teamId, setTeamId] = useState<string | null>(null);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [workstationId, setWorkstationId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<AppointmentStatus>('ingepland');
  const [snapshot, setSnapshot] = useState<Appointment | null>(null); // bewerken: vastgelegde prijzen/tijden
  const [initialized, setInitialized] = useState(!isEdit);
  const [saveError, setSaveError] = useState<FriendlyError | null>(null);
  const [forcePrompt, setForcePrompt] = useState(false);

  // Bewerken: bestaande afspraak inladen
  useEffect(() => {
    const a = existing.data;
    if (!isEdit || !a || initialized) return;
    setCustomer(a.customer_id ? { id: a.customer_id, name: a.customer_name, phone: a.customer_phone, email: a.customer_email } : null);
    setVehicleId(a.vehicle_id);
    setVehicle(rowToDraft(a.vehicle as never));
    setVehicleSkipped(!a.vehicle_id && !Object.keys(a.vehicle ?? {}).length);
    const items = [...(a.appointment_items ?? [])].sort((x, y) => x.position - y.position);
    setSelections(
      items.map((i) => ({
        serviceId: i.service_id ?? `verwijderd-${i.id}`,
        modelExceptionId: i.model_exception_id ?? null,
        priceOverrideCents: i.price_overridden ? i.price_cents : undefined,
        durationOverrideMin: i.duration_overridden ? i.duration_min : undefined,
        filmBrand: i.film_brand,
        filmPercentage: i.film_percentage,
        filmColor: i.film_color,
        measuredVlt: i.measured_vlt,
        note: i.note,
      })),
    );
    setSnapshot(a);
    setDate(isoDateOf(a.starts_at));
    setTime(formatTime(a.starts_at));
    setBufferMin(a.buffer_min);
    setTeamId(a.team_id);
    setAssigneeId(a.assignee_id);
    setWorkstationId(a.workstation_id);
    setNotes(a.internal_notes ?? '');
    setStatus(a.status);
    setOpen(params.stap === 'planning' ? 'planning' : null);
    setInitialized(true);
  }, [existing.data, isEdit, initialized, params.stap]);

  // Nieuwe afspraak vanuit klantkaart
  const preCustomer = useCustomer(!isEdit ? params.customerId : undefined);
  useEffect(() => {
    const c = preCustomer.data?.customer;
    if (!c || customer) return;
    setCustomer({ id: c.id, name: c.name, phone: c.phone, email: c.email });
    const v = params.vehicleId ? c.vehicles.find((x) => x.id === params.vehicleId) : undefined;
    if (v) {
      setVehicleId(v.id);
      setVehicle(rowToDraft(v));
      setOpen('behandeling');
    } else setOpen('auto');
  }, [preCustomer.data, customer, params.vehicleId]);

  // Nieuwe afspraak: standaard de eigen partij en (als er maar één is) de werkplek.
  const defaultsApplied = useRef(false);
  useEffect(() => {
    if (isEdit || defaultsApplied.current || !profile || !workstations.data) return;
    defaultsApplied.current = true;
    if (profile.team_id) setTeamId(profile.team_id);
    const active = workstations.data.filter((w) => w.active);
    if (active.length === 1) setWorkstationId(active[0].id);
  }, [isEdit, profile, workstations.data]);

  const vehicleInput: VehicleInput = useMemo(() => (vehicle ? draftToRow(vehicle) : {}), [vehicle]);
  const quote = useMemo(
    () => (catalog.data ? computeQuote(catalog.data, vehicleInput, selections, { durationOverrideMin: durationOverride }) : null),
    [catalog.data, vehicleInput, selections, durationOverride],
  );

  const effectiveDuration = snapshot ? durationOverride ?? snapshot.duration_min : quote?.durationMin ?? null;
  const effectiveBuffer = bufferMin ?? settings.data?.default_buffer_min ?? 0;

  const changeSelections = (next: LineSelection[]) => {
    if (snapshot) setSnapshot(null); // vanaf nu opnieuw berekenen met de huidige catalogus
    setSelections(next);
  };

  const vehicleSummary = vehicle
    ? [vehicle.make, vehicle.model, vehicle.variant, vehicle.build_year].filter(Boolean).join(' ') +
      (vehicle.plate ? ` · ${vehicle.plate}` : '') || 'Auto'
    : vehicleSkipped
      ? 'Auto nog onbekend'
      : '';

  if (!initialized || catalog.isLoading || settings.isLoading) return <Loading />;
  if (catalog.error) return <Loading label="Catalogus laden mislukt — controleer de verbinding." />;

  // ---------------------------------------------------------------------------
  const startsAtIso = time ? localToUtcIso(date, time) : null;
  const endIso = startsAtIso && effectiveDuration ? new Date(new Date(startsAtIso).getTime() + effectiveDuration * 60000).toISOString() : null;
  const team = (teams.data ?? []).find((t) => t.id === teamId);

  const priceCents = snapshot ? (snapshot.price_complete ? snapshot.price_total_cents : null) : quote?.totalPriceCents ?? null;
  const knownCents = snapshot ? snapshot.price_total_cents ?? 0 : quote?.knownTotalCents ?? 0;
  const priceLabel =
    priceCents != null ? formatEuro(priceCents) : selections.length && knownCents ? `${formatEuro(knownCents)} + ?` : selections.length ? 'prijs nog te bepalen' : '—';
  const serviceNames = snapshot
    ? [...(snapshot.appointment_items ?? [])].sort((x, y) => x.position - y.position).map((i) => i.service_name)
    : (quote?.lines ?? []).map((l) => l.serviceName);
  const missing = !customer ? 'klant' : !selections.length ? 'behandeling' : !effectiveDuration ? 'behandelduur' : !time ? 'tijd' : null;

  const buildPayload = (force = false, overrideReason = '') => {
    const v = vehicle ? draftToRow(vehicle) : null;
    const items = snapshot
      ? [...(snapshot.appointment_items ?? [])]
          .sort((x, y) => x.position - y.position)
          .map(({ id: _id, appointment_id: _a, position: _p, ...rest }) => rest)
      : quoteToItems(quote!);
    return {
      id: editId ?? null,
      expected_version: snapshot?.version ?? existing.data?.version ?? null,
      client_request_id: requestId.current,
      customer_id: customer?.id ?? null,
      vehicle_id: vehicleId,
      customer_name: customer?.name ?? '',
      customer_phone: customer?.phone ?? null,
      customer_email: customer?.email ?? null,
      vehicle: v ?? {},
      starts_at: startsAtIso,
      duration_min: effectiveDuration,
      duration_overridden: snapshot ? durationOverride != null : quote?.durationOverridden ?? false,
      buffer_min: effectiveBuffer,
      team_id: teamId,
      assignee_id: assigneeId,
      workstation_id: workstationId,
      status,
      internal_notes: notes.trim() || null,
      items,
      force,
      override_reason: overrideReason || null,
    };
  };

  const doSave = async (force = false, reason = '') => {
    setSaveError(null);
    try {
      const res = await save.mutateAsync(buildPayload(force, reason));
      toast(res.duplicate ? 'Afspraak was al opgeslagen' : isEdit ? 'Wijziging opgeslagen' : 'Afspraak opgeslagen');
      router.replace(`/afspraak/${res.appointment.id}`);
    } catch (e) {
      const f = toFriendlyError(e);
      setSaveError(f);
      if (f.kind === 'conflict' && editId) {
        await qc.invalidateQueries({ queryKey: qk.appointment(editId) });
        setInitialized(false);
        Alert.alert(f.title, f.message);
      }
    }
  };

  const toggle = (key: BlockKey) => setOpen(open === key ? null : key);

  return (
    <>
      <Stack.Screen options={{ title: isEdit ? 'Afspraak wijzigen' : 'Nieuwe afspraak' }} />
      <Screen
        footer={
          <View style={{ gap: space.sm }}>
            {saveError ? (
              <Notice kind="danger">
                {saveError.title}: {saveError.message}
                {saveError.problems?.length ? '\n• ' + saveError.problems.map((p) => p.message).join('\n• ') : ''}
              </Notice>
            ) : null}
            {saveError?.kind === 'rules' ? (
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                <Button title="Ander tijdstip" variant="secondary" onPress={() => { setSaveError(null); setOpen('planning'); }} style={{ flex: 1 }} />
                {isOwner && saveError.problems?.every((p) => p.overridable) ? (
                  <Button title="Toch opslaan" variant="danger" onPress={() => setForcePrompt(true)} style={{ flex: 1 }} />
                ) : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ color: colors.text, fontSize: 20, fontWeight: '800' }} numberOfLines={1}>
                  {priceLabel}
                </Text>
                <Text style={{ color: colors.textDim, fontSize: 13 }} numberOfLines={2}>
                  {missing
                    ? `Nog kiezen: ${missing}`
                    : `${formatDateShort(date)} · ${time}–${endIso ? formatTime(endIso) : ''} · ${formatDuration(effectiveDuration)}`}
                </Text>
              </View>
              <Button
                title={isEdit ? 'Opslaan' : 'Afspraak opslaan'}
                onPress={() => doSave()}
                loading={save.isPending}
                disabled={!!missing}
                big
                style={{ minWidth: 160 }}
              />
            </View>
          </View>
        }
      >
        <Block
          n={1}
          title="Klant"
          done={!!customer}
          summary={customer ? `${customer.name}${customer.phone ? ` · ${customer.phone}` : ''}` : 'Zoek of voeg toe'}
          open={open === 'klant'}
          onToggle={() => toggle('klant')}
          accent={accent}
        >
          <CustomerStep
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              if (c && !isEdit) {
                setVehicleId(null);
                setVehicle(null);
                setVehicleSkipped(false);
              }
              if (c) setOpen('auto');
            }}
          />
        </Block>

        <Block
          n={2}
          title="Auto"
          done={!!vehicle || vehicleSkipped}
          summary={vehicleSummary || (customer ? 'Kies of voeg toe' : 'Kies eerst een klant')}
          open={open === 'auto'}
          onToggle={() => toggle('auto')}
          disabled={!customer}
          accent={accent}
        >
          {customer ? (
            <VehicleStep
              customerId={customer.id}
              vehicleId={vehicleId}
              draft={vehicle}
              skipped={vehicleSkipped}
              onSelect={(id, draft, advance) => {
                setVehicleId(id);
                setVehicle(draft);
                setVehicleSkipped(false);
                if (advance) setOpen('behandeling');
              }}
              onSkip={() => {
                setVehicleId(null);
                setVehicle(null);
                setVehicleSkipped(true);
                setOpen('behandeling');
              }}
            />
          ) : null}
        </Block>

        <Block
          n={3}
          title="Behandeling"
          done={selections.length > 0}
          summary={serviceNames.length ? `${serviceNames.join(' + ')} · ${priceLabel}` : 'Kies wat er gedaan wordt'}
          open={open === 'behandeling'}
          onToggle={() => toggle('behandeling')}
          accent={accent}
        >
          <ServicesStep
            selections={selections}
            onChange={changeSelections}
            quote={quote}
            snapshot={snapshot}
            vehicleInput={vehicleInput}
            filmPercentages={settings.data?.film_percentages ?? []}
          />
          {selections.length ? (
            <Button title="Verder: datum en tijd" onPress={() => setOpen('planning')} style={{ marginTop: space.md }} />
          ) : null}
        </Block>

        <Block
          n={4}
          title="Wanneer en wie"
          done={!!time}
          summary={
            time && endIso
              ? `${formatDateShort(date)} ${time}–${formatTime(endIso)} · ${team?.name ?? 'Niet toegewezen'}`
              : `${formatDateShort(date)} · kies een tijd`
          }
          open={open === 'planning'}
          onToggle={() => toggle('planning')}
          accent={accent}
        >
          <Text style={ui.label}>Uitvoerende partij</Text>
          <ChipRow>
            {(teams.data ?? [])
              .filter((t) => t.active || t.id === teamId)
              .map((t) => (
                <Chip key={t.id} label={t.name} color={t.color} selected={teamId === t.id} onPress={() => setTeamId(t.id)} />
              ))}
            <Chip label="Niet toegewezen" color={UNASSIGNED_COLOR} selected={!teamId} onPress={() => setTeamId(null)} />
          </ChipRow>
          <DateTimePickerSection
            date={date}
            time={time}
            onDate={(d) => {
              setDate(d);
              setTime(null);
            }}
            onTime={setTime}
            duration={effectiveDuration}
            buffer={effectiveBuffer}
            teamId={teamId}
            assigneeId={assigneeId}
            workstationId={workstationId}
            excludeId={editId ?? null}
            accent={accent}
          />
          <Button
            title={showMore ? 'Minder opties' : 'Meer opties: duur, buffer, medewerker, werkplek'}
            variant="ghost"
            onPress={() => setShowMore(!showMore)}
            style={{ marginTop: space.md, alignSelf: 'flex-start', paddingHorizontal: 0 }}
          />
          {showMore ? (
            <View>
              <DurationCard
                duration={effectiveDuration}
                standard={snapshot ? snapshot.duration_min : quote?.standardDurationMin ?? null}
                override={durationOverride}
                onOverride={setDurationOverride}
                buffer={effectiveBuffer}
                onBuffer={setBufferMin}
              />
              <Text style={[ui.label, { marginTop: space.md }]}>Medewerker</Text>
              <ChipRow>
                <Chip label="Geen" selected={!assigneeId} onPress={() => setAssigneeId(null)} />
                {(profiles.data ?? [])
                  .filter((p) => p.active || p.id === assigneeId)
                  .map((p) => (
                    <Chip key={p.id} label={p.display_name} selected={assigneeId === p.id} onPress={() => setAssigneeId(p.id)} />
                  ))}
              </ChipRow>
              {(workstations.data ?? []).some((w) => w.active) ? (
                <>
                  <Text style={[ui.label, { marginTop: space.md }]}>Werkplek</Text>
                  <ChipRow>
                    <Chip label="Geen" selected={!workstationId} onPress={() => setWorkstationId(null)} />
                    {(workstations.data ?? [])
                      .filter((w) => w.active || w.id === workstationId)
                      .map((w) => (
                        <Chip key={w.id} label={w.name} selected={workstationId === w.id} onPress={() => setWorkstationId(w.id)} />
                      ))}
                  </ChipRow>
                </>
              ) : null}
            </View>
          ) : null}
          {effectiveDuration == null && selections.length ? (
            <Notice kind="warning">De behandelduur is onbekend. Vul onder "Meer opties" de totale duur in.</Notice>
          ) : null}
        </Block>

        <Block
          n={5}
          title={isEdit ? 'Status en opmerkingen' : 'Opmerkingen'}
          done={!!notes.trim() || isEdit}
          optional
          summary={[isEdit ? STATUSES.find((s) => s.value === status)?.label : null, notes.trim() || (isEdit ? null : 'Optioneel')].filter(Boolean).join(' · ')}
          open={open === 'extra'}
          onToggle={() => toggle('extra')}
          accent={accent}
        >
          {isEdit ? (
            <>
              <Text style={ui.label}>Status</Text>
              <ChipRow>
                {STATUSES.map((s) => (
                  <Chip key={s.value} label={s.label} color={statusColors[s.value]} selected={status === s.value} onPress={() => setStatus(s.value)} />
                ))}
              </ChipRow>
              <View style={{ height: space.md }} />
            </>
          ) : null}
          <Field label="Interne opmerkingen (alleen voor het team)" value={notes} onChangeText={setNotes} multiline />
        </Block>

        {selections.length ? <PriceSummary quote={quote} snapshot={snapshot} /> : null}
      </Screen>
      <PromptModal
        visible={forcePrompt}
        title="Bewuste uitzondering"
        message="Je slaat deze afspraak op buiten de ingestelde openingstijden/pauzes/blokkades. Capaciteit blijft altijd bewaakt. Geef een reden (wordt vastgelegd)."
        placeholder="Reden"
        confirmLabel="Toch opslaan"
        destructive
        required
        loading={save.isPending}
        onCancel={() => setForcePrompt(false)}
        onConfirm={(reason) => {
          setForcePrompt(false);
          doSave(true, reason);
        }}
      />
    </>
  );
}

type BlockKey = 'klant' | 'auto' | 'behandeling' | 'planning' | 'extra';

function Block({
  n,
  title,
  summary,
  done,
  open,
  onToggle,
  disabled,
  optional,
  accent,
  children,
}: {
  n: number;
  title: string;
  summary: string;
  done: boolean;
  open: boolean;
  onToggle: () => void;
  disabled?: boolean;
  optional?: boolean;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <View style={[blockStyles.block, open && { borderColor: accent }]}>
      <Pressable
        onPress={disabled ? undefined : onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open, disabled: !!disabled }}
        accessibilityLabel={`${title}: ${summary}`}
        style={({ pressed }) => [blockStyles.header, pressed && !disabled && { opacity: 0.7 }, disabled && { opacity: 0.45 }]}
      >
        <View style={[blockStyles.num, done && !optional ? { backgroundColor: accent, borderColor: accent } : null]}>
          <Text style={[blockStyles.numText, done && !optional ? { color: onColor(accent) } : null]}>{done && !optional ? '✓' : n}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={blockStyles.title}>{title}</Text>
          {!open ? (
            <Text style={blockStyles.summary} numberOfLines={2}>
              {summary}
            </Text>
          ) : null}
        </View>
        {!disabled ? <Text style={[blockStyles.action, { color: accent }]}>{open ? 'Sluit' : done ? 'Wijzig' : 'Open'}</Text> : null}
      </Pressable>
      {open ? <View style={blockStyles.body}>{children}</View> : null}
    </View>
  );
}

const blockStyles = StyleSheet.create({
  block: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, marginBottom: space.md, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, minHeight: 64 },
  num: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  numText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  title: { color: colors.text, fontWeight: '800', fontSize: 17 },
  summary: { color: colors.textDim, fontSize: 14, marginTop: 2 },
  action: { fontWeight: '700', fontSize: 15 },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg },
});

// ---------------------------------------------------------------------------
// Stap 1: klant
// ---------------------------------------------------------------------------
function CustomerStep({ value, onChange }: { value: CustomerSel | null; onChange: (c: CustomerSel | null) => void }) {
  const [term, setTerm] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useCustomerSearch(term.length >= 2 ? term : '');
  const qc = useQueryClient();

  if (value && !creating) {
    return (
      <Card>
        <T.H2>{value.name}</T.H2>
        <T.Muted>{value.phone ?? 'Geen telefoonnummer'}</T.Muted>
        {value.email ? <T.Muted>{value.email}</T.Muted> : null}
        <Button title="Andere klant kiezen" variant="ghost" onPress={() => onChange(null)} style={{ marginTop: space.sm }} />
      </Card>
    );
  }

  const create = async () => {
    if (!name.trim()) {
      setError('Vul minimaal een naam in.');
      return;
    }
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('customers')
      .insert({ name: name.trim(), phone: phone.trim() || null, email: email.trim() || null })
      .select()
      .single();
    setBusy(false);
    if (err) {
      setError(toFriendlyError(err).message);
      return;
    }
    qc.invalidateQueries({ queryKey: qk.customers });
    setCreating(false);
    onChange({ id: data.id, name: data.name, phone: data.phone, email: data.email });
  };

  if (creating) {
    return (
      <View>
        <T.H2 style={{ marginBottom: space.md }}>Nieuwe klant</T.H2>
        <Field label="Naam *" value={name} onChangeText={setName} autoCapitalize="words" />
        <Field label="Telefoonnummer" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
        <Field label="E-mailadres (optioneel)" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <Button title="Klant opslaan" onPress={create} loading={busy} />
        <Button title="Terug naar zoeken" variant="ghost" onPress={() => setCreating(false)} style={{ marginTop: space.sm }} />
      </View>
    );
  }

  return (
    <View>
      <TextInput
        value={term}
        onChangeText={setTerm}
        placeholder="Zoek op naam, telefoon of kenteken"
        placeholderTextColor={colors.textFaint}
        style={ui.input}
        autoFocus
        autoCorrect={false}
      />
      <Button
        title="Nieuwe klant toevoegen"
        icon="＋"
        variant="secondary"
        onPress={() => {
          setCreating(true);
          if (/\d{6,}/.test(term.replace(/\D/g, ''))) setPhone(term);
          else setName(term);
        }}
        style={{ marginVertical: space.md }}
      />
      {term.length >= 2 && search.isLoading ? <Loading /> : null}
      {(search.data ?? []).map((c) => (
        <Card key={c.id} onPress={() => onChange({ id: c.id, name: c.name, phone: c.phone, email: c.email })}>
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>{c.name}</Text>
          <T.Muted>{[c.phone, ...c.vehicles.map((v) => v.plate?.toUpperCase())].filter(Boolean).join(' · ') || '—'}</T.Muted>
        </Card>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stap 2: auto
// ---------------------------------------------------------------------------
function VehicleStep({
  customerId,
  vehicleId,
  draft,
  skipped,
  onSelect,
  onSkip,
}: {
  customerId: string;
  vehicleId: string | null;
  draft: VehicleDraft | null;
  skipped: boolean;
  onSelect: (id: string | null, d: VehicleDraft, advance: boolean) => void;
  onSkip: () => void;
}) {
  const c = useCustomer(customerId);
  const [editDetails, setEditDetails] = useState(false);
  const qc = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<VehicleDraft>({ ...emptyVehicle });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const vehicles = (c.data?.customer.vehicles ?? []).filter((v) => !v.archived_at);

  const create = async () => {
    setBusy(true);
    setError(null);
    const { data, error: err } = await supabase
      .from('vehicles')
      .insert({ customer_id: customerId, ...draftToRow(form) })
      .select()
      .single();
    setBusy(false);
    if (err) {
      setError(toFriendlyError(err).message);
      return;
    }
    qc.invalidateQueries({ queryKey: qk.customers });
    setCreating(false);
    onSelect(data.id, rowToDraft(data), true);
  };

  // Aangepaste autogegevens ook bij de auto zelf bewaren (voor de volgende keer).
  const saveDetails = async () => {
    if (!vehicleId || !draft) return;
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.from('vehicles').update(draftToRow(draft)).eq('id', vehicleId);
    setBusy(false);
    if (err) {
      setError(toFriendlyError(err).message);
      return;
    }
    qc.invalidateQueries({ queryKey: qk.customers });
    setEditDetails(false);
    onSelect(vehicleId, draft, true);
  };

  if (c.isLoading) return <Loading />;
  if (creating || (!vehicles.length && !skipped && !draft)) {
    return (
      <View>
        <T.H2 style={{ marginBottom: space.md }}>Nieuwe auto</T.H2>
        <T.Muted style={{ marginBottom: space.md }}>Alleen invullen wat bekend is. Carrosserie en ramen bepalen de prijs.</T.Muted>
        <VehicleForm value={form} onChange={setForm} />
        {error ? <Notice kind="danger">{error}</Notice> : null}
        <Button title="Auto opslaan" onPress={create} loading={busy} />
        <Button title="Auto nog onbekend — overslaan" variant="ghost" onPress={() => { setCreating(false); onSkip(); }} style={{ marginTop: space.sm }} />
        {vehicles.length ? <Button title="Bestaande auto kiezen" variant="ghost" onPress={() => setCreating(false)} /> : null}
      </View>
    );
  }

  return (
    <View>
      {vehicles.map((v) => (
        <Card
          key={v.id}
          onPress={() => onSelect(v.id, rowToDraft(v), !!v.body_type)}
          style={vehicleId === v.id ? { borderColor: colors.info, borderWidth: 2 } : undefined}
        >
          <Text style={{ color: colors.text, fontWeight: '700', fontSize: 16 }}>
            {vehicleId === v.id ? '✓ ' : ''}
            {[v.make, v.model, v.variant].filter(Boolean).join(' ') || 'Auto'} {v.build_year ? `(${v.build_year})` : ''}
          </Text>
          <T.Muted>
            {[v.plate?.toUpperCase(), v.body_type, v.rear_window_count ? `${v.rear_window_count} achterramen` : null].filter(Boolean).join(' · ')}
          </T.Muted>
        </Card>
      ))}
      {vehicleId && draft ? (
        !draft.body_type || editDetails ? (
          <Section title="Gegevens voor deze afspraak">
            {!draft.body_type ? (
              <Notice kind="warning">Vul de carrosserie (en het aantal achterramen) in, dan wordt de prijs automatisch berekend.</Notice>
            ) : (
              <T.Muted style={{ marginBottom: space.sm }}>Aanpassingen hier gelden voor de prijsberekening van deze afspraak.</T.Muted>
            )}
            <VehicleForm value={draft} onChange={(d) => onSelect(vehicleId, d, false)} />
            {error ? <Notice kind="danger">{error}</Notice> : null}
            <Button title="Opslaan bij de auto en verder" onPress={saveDetails} loading={busy} />
          </Section>
        ) : (
          <Button title="Autogegevens aanpassen" variant="ghost" onPress={() => setEditDetails(true)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
        )
      ) : null}
      <Button title="Andere auto toevoegen" icon="＋" variant="secondary" onPress={() => setCreating(true)} style={{ marginTop: space.md }} />
      <Button title={skipped ? '✓ Auto nog onbekend' : 'Auto nog onbekend — overslaan'} variant="ghost" onPress={onSkip} style={{ marginTop: space.sm }} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stap 3: behandelingen
// ---------------------------------------------------------------------------
function ServicesStep({
  selections,
  onChange,
  quote,
  snapshot,
  vehicleInput,
  filmPercentages,
}: {
  selections: LineSelection[];
  onChange: (s: LineSelection[]) => void;
  quote: ReturnType<typeof computeQuote> | null;
  snapshot: Appointment | null;
  vehicleInput: VehicleInput;
  filmPercentages: number[];
}) {
  const catalog = useCatalog();
  const services = (catalog.data?.services ?? []).filter((s) => s.active || selections.some((x) => x.serviceId === s.id));
  const toggle = (id: string) => {
    if (selections.some((s) => s.serviceId === id)) onChange(selections.filter((s) => s.serviceId !== id));
    else onChange([...selections, { serviceId: id }]);
  };
  const update = (id: string, patch: Partial<LineSelection>) => onChange(selections.map((s) => (s.serviceId === id ? { ...s, ...patch } : s)));
  const [expanded, setExpanded] = useState<string[]>([]);

  // Snelkeuzes: vaak geboekte combinaties met één tik.
  const byCode = (code: string) => (catalog.data?.services ?? []).find((x) => x.code === code && x.active);
  const quickPicks = QUICK_PICKS.map((q) => ({ ...q, ids: q.codes.map((c) => byCode(c)?.id) })).filter(
    (q): q is typeof q & { ids: string[] } => q.ids.every(Boolean),
  );
  const selectedKey = selections.map((x) => x.serviceId).sort().join(',');
  const applyPick = (ids: string[]) =>
    onChange(ids.map((id) => selections.find((x) => x.serviceId === id) ?? { serviceId: id }));
  const pickedCompleet = ['bstijl', 'voorportieren'].every((c) => selections.some((x) => x.serviceId === byCode(c)?.id)) &&
    ['kameleon_voorruit', 'keramisch_voorruit'].some((c) => selections.some((x) => x.serviceId === byCode(c)?.id));

  return (
    <View>
      {quickPicks.length ? (
        <View style={{ marginBottom: space.md }}>
          <Text style={ui.label}>Snel kiezen</Text>
          <ChipRow>
            {quickPicks.map((q) => (
              <Chip key={q.label} label={q.label} selected={[...q.ids].sort().join(',') === selectedKey} onPress={() => applyPick(q.ids)} />
            ))}
          </ChipRow>
        </View>
      ) : null}
      <Text style={ui.label}>Behandelingen (meerdere mogelijk)</Text>
      {snapshot ? (
        <Notice>
          Prijzen en tijden zijn vastgelegd bij het boeken. Pas je hier iets aan, dan wordt opnieuw berekend met de huidige catalogus.
        </Notice>
      ) : null}
      {!vehicleInput.body_type ? <Notice kind="warning">Carrosserie onbekend: prijzen kunnen nog niet automatisch bepaald worden.</Notice> : null}
      {!snapshot && pickedCompleet && vehicleInput.body_type && !(quote?.bundle?.name ?? '').startsWith('Compleet') && !quote?.lines.some((l) => l.exceptionId) ? (
        <Notice kind="warning">
          Voor deze auto is geen vaste prijs voor compleet ingesteld (vast: hatchback, sedan, station met 5 of 7 ramen). Hieronder staan de losse prijzen met
          combinatiekorting — pas de prijs zo nodig aan.
        </Notice>
      ) : null}
      <ChipRow>
        {services.map((s) => (
          <Chip key={s.id} label={s.name + (s.active ? '' : ' (inactief)')} selected={selections.some((x) => x.serviceId === s.id)} onPress={() => toggle(s.id)} />
        ))}
      </ChipRow>

      {selections.map((sel) => {
        const service = catalog.data?.services.find((s) => s.id === sel.serviceId);
        const line = quote?.lines.find((l) => l.serviceId === sel.serviceId);
        const snapItem = snapshot?.appointment_items?.find((i) => (i.service_id ?? `verwijderd-${i.id}`) === sel.serviceId);
        const exceptions = (catalog.data?.exceptions ?? []).filter((e) => e.service_id === sel.serviceId && e.active);
        const percentages = service?.film_percentages ?? filmPercentages;
        return (
          <Card key={sel.serviceId} style={{ marginTop: space.md }}>
            <Text style={{ color: colors.text, fontWeight: '800', fontSize: 17 }}>{service?.name ?? snapItem?.service_name ?? 'Behandeling'}</Text>
            {snapshot && snapItem ? (
              <T.Muted>
                Vastgelegd: {formatEuro(snapItem.price_cents)} · {formatDuration(snapItem.duration_min)}
              </T.Muted>
            ) : line ? (
              <>
                {line.bundleId && quote?.bundle?.priceCents != null ? (
                  <Text style={{ color: colors.info, marginTop: 2 }}>
                    Onderdeel van pakket "{line.bundleLabel}" — {formatEuro(quote.bundle.priceCents)} totaal
                  </Text>
                ) : (
                  <T.Muted>
                    Standaard: {formatEuro(line.standardPriceCents)} · {formatDuration(line.standardDurationMin)}
                    {line.ruleLabel ? ` (${line.ruleLabel})` : ''}
                  </T.Muted>
                )}
                {line.exceptionLabel ? <Text style={{ color: colors.info, marginTop: 2 }}>Modeluitzondering: {line.exceptionLabel}</Text> : null}
                {line.bundleLabel && quote?.bundle?.priceCents == null ? <Text style={{ color: colors.info, marginTop: 2 }}>Pakket: {line.bundleLabel}</Text> : null}
                {line.notes.map((n) => (
                  <Text key={n} style={{ color: colors.warning, marginTop: 2 }}>
                    {n}
                  </Text>
                ))}
              </>
            ) : null}

            {exceptions.length && (line?.exceptionId || sel.modelExceptionId !== undefined || expanded.includes(sel.serviceId)) ? (
              <View style={{ marginTop: space.sm }}>
                <Text style={ui.label}>Modeluitzondering</Text>
                <ChipRow>
                  <Chip label="Automatisch" selected={sel.modelExceptionId === undefined} onPress={() => update(sel.serviceId, { modelExceptionId: undefined })} />
                  {exceptions.map((e) => (
                    <Chip key={e.id} label={e.label} selected={sel.modelExceptionId === e.id} onPress={() => update(sel.serviceId, { modelExceptionId: e.id })} />
                  ))}
                  <Chip label="Geen" selected={sel.modelExceptionId === null} onPress={() => update(sel.serviceId, { modelExceptionId: null })} />
                </ChipRow>
              </View>
            ) : null}

            {service?.film_brands?.length ? (
              <View style={{ marginTop: space.sm }}>
                <Text style={ui.label}>Foliemerk</Text>
                <ChipRow>
                  {service.film_brands.map((b) => (
                    <Chip key={b} label={b} selected={sel.filmBrand === b} onPress={() => update(sel.serviceId, { filmBrand: sel.filmBrand === b ? null : b })} />
                  ))}
                </ChipRow>
              </View>
            ) : null}
            {percentages.length ? (
              <View style={{ marginTop: space.sm }}>
                <Text style={ui.label}>Foliepercentage{service?.film_percentages ? '' : ' (bedrijfslijst — controleer beschikbaarheid per raam)'}</Text>
                <ChipRow>
                  {percentages.map((p) => (
                    <Chip key={p} label={`${p}%`} selected={sel.filmPercentage === p} onPress={() => update(sel.serviceId, { filmPercentage: sel.filmPercentage === p ? null : p })} />
                  ))}
                </ChipRow>
              </View>
            ) : null}
            {service?.film_colors?.length ? (
              <View style={{ marginTop: space.sm }}>
                <Text style={ui.label}>Kleur</Text>
                <ChipRow>
                  {service.film_colors.map((c) => (
                    <Chip key={c} label={c} selected={sel.filmColor === c} onPress={() => update(sel.serviceId, { filmColor: sel.filmColor === c ? null : c })} />
                  ))}
                </ChipRow>
              </View>
            ) : null}

            {!(expanded.includes(sel.serviceId) || sel.priceOverrideCents != null || sel.durationOverrideMin != null || sel.manualDiscountCents || sel.note || sel.measuredVlt != null) ? (
              <Button
                title="Prijs, duur, korting of notitie aanpassen"
                variant="ghost"
                onPress={() => setExpanded([...expanded, sel.serviceId])}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 0, marginTop: space.sm, minHeight: 36 }}
              />
            ) : (
            <View>
            <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.md }}>
              <MoneyInput
                label="Prijs aanpassen (€)"
                cents={sel.priceOverrideCents ?? null}
                placeholder={line?.standardPriceCents != null ? centsToInput(line.standardPriceCents) : 'bv. 95'}
                onChange={(c) => update(sel.serviceId, { priceOverrideCents: c })}
              />
              <IntInput
                label="Duur aanpassen (min)"
                value={sel.durationOverrideMin ?? null}
                placeholder={line?.standardDurationMin != null ? String(line.standardDurationMin) : 'bv. 60'}
                onChange={(n) => update(sel.serviceId, { durationOverrideMin: n })}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <MoneyInput label="Extra korting (€)" cents={sel.manualDiscountCents ?? null} onChange={(c) => update(sel.serviceId, { manualDiscountCents: c })} />
              <Field
                label="Gemeten lichtdoorlaat %"
                value={sel.measuredVlt != null ? String(sel.measuredVlt) : ''}
                onChangeText={(t) => {
                  const n = parseFloat(t.replace(',', '.'));
                  update(sel.serviceId, { measuredVlt: t.trim() === '' || Number.isNaN(n) ? null : n });
                }}
                keyboardType="decimal-pad"
                style={{ flex: 1 }}
                hint="Glas + folie, optioneel"
              />
            </View>
            {sel.manualDiscountCents ? (
              <Field label="Reden korting" value={sel.manualDiscountLabel ?? ''} onChangeText={(t) => update(sel.serviceId, { manualDiscountLabel: t })} />
            ) : null}
            <Field label="Notitie bij deze behandeling" value={sel.note ?? ''} onChangeText={(t) => update(sel.serviceId, { note: t })} />
            </View>
            )}
          </Card>
        );
      })}
      {!selections.length ? <T.Muted style={{ marginTop: space.md }}>Kies één of meer behandelingen.</T.Muted> : null}
    </View>
  );
}

const QUICK_PICKS = [
  { label: 'Compleet + kameleon', codes: ['bstijl', 'voorportieren', 'kameleon_voorruit'] },
  { label: 'Compleet + zwarte voorruit', codes: ['bstijl', 'voorportieren', 'keramisch_voorruit'] },
  { label: 'B-stijl + voorportieren', codes: ['bstijl', 'voorportieren'] },
  { label: 'B-stijl + kameleon', codes: ['bstijl', 'kameleon_voorruit'] },
];

function MoneyInput({ label, cents, onChange, placeholder }: { label: string; cents: number | null; onChange: (c: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(centsToInput(cents));
  const parsed = parseEuroToCents(text);
  return (
    <Field
      label={label}
      value={text}
      placeholder={placeholder}
      onChangeText={(t) => {
        setText(t);
        const c = parseEuroToCents(t);
        if (c === null || !Number.isNaN(c)) onChange(c);
      }}
      keyboardType="decimal-pad"
      error={parsed != null && Number.isNaN(parsed) ? 'Ongeldig bedrag' : null}
      style={{ flex: 1 }}
    />
  );
}

function IntInput({ label, value, onChange, placeholder }: { label: string; value: number | null; onChange: (n: number | null) => void; placeholder?: string }) {
  const [text, setText] = useState(value != null ? String(value) : '');
  return (
    <Field
      label={label}
      value={text}
      placeholder={placeholder}
      onChangeText={(t) => {
        setText(t);
        const n = parseIntOrNull(t);
        if (n === null || (!Number.isNaN(n) && n > 0)) onChange(n);
      }}
      keyboardType="number-pad"
      style={{ flex: 1 }}
    />
  );
}

function PriceSummary({ quote, snapshot }: { quote: ReturnType<typeof computeQuote> | null; snapshot: Appointment | null }) {
  if (snapshot) {
    const items = [...(snapshot.appointment_items ?? [])].sort((a, b) => a.position - b.position);
    return (
      <Card style={{ marginTop: space.md }}>
        <Text style={ui.sectionTitle}>Prijs (vastgelegd)</Text>
        {items.map((i) => (
          <Row
            key={i.id}
            label={`${i.service_name}${i.price_overridden ? ' (aangepast)' : ''}`}
            value={`${i.bundle_label && i.price_cents === 0 && !i.price_overridden ? 'inbegrepen' : formatEuro(i.price_cents)}${i.discount_cents ? ` − ${formatEuro(i.discount_cents)}` : ''}`}
          />
        ))}
        <Row label="Totaal" value={<Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>{snapshot.price_complete ? formatEuro(snapshot.price_total_cents) : 'nog te bepalen'}</Text>} />
      </Card>
    );
  }
  if (!quote) return null;
  return (
    <Card style={{ marginTop: space.md }}>
      <Text style={ui.sectionTitle}>Prijs en duur</Text>
      {quote.lines.map((l) => (
        <View key={l.serviceId}>
          <Row
            label={`${l.serviceName}${l.priceOverridden ? ' ✎' : ''}`}
            value={
              <Text style={{ color: l.priceOverridden ? colors.warning : colors.text }}>
                {l.bundleId && l.priceCents === 0 && !l.priceOverridden ? 'inbegrepen' : formatEuro(l.priceCents)}
                {l.priceOverridden ? ` (standaard ${formatEuro(l.standardPriceCents)})` : ''}
              </Text>
            }
          />
          {l.discountCents ? <Row label={`   Korting: ${l.discountLabel}`} value={<Text style={{ color: colors.success }}>− {formatEuro(l.discountCents)}</Text>} /> : null}
        </View>
      ))}
      <Row
        label="Totaal"
        value={
          <Text style={{ color: colors.text, fontWeight: '800', fontSize: 18 }}>
            {quote.totalPriceCents != null ? formatEuro(quote.totalPriceCents) : quote.knownTotalCents ? `${formatEuro(quote.knownTotalCents)} + nog te bepalen` : 'nog te bepalen'}
          </Text>
        }
      />
      <Row
        label="Behandelduur"
        value={
          <Text style={{ color: quote.durationOverridden ? colors.warning : colors.text }}>
            {formatDuration(quote.durationMin)}
            {quote.durationOverridden ? ` (standaard ${formatDuration(quote.standardDurationMin)})` : ''}
          </Text>
        }
      />
      {quote.deviatesFromStandard ? <Text style={{ color: colors.warning, marginTop: space.sm }}>✎ Wijkt af van de standaard</Text> : null}
      {quote.warnings.map((w) => (
        <Text key={w} style={{ color: colors.warning, marginTop: 4 }}>
          ⚠ {w}
        </Text>
      ))}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Stap 4: duur, datum en tijd
// ---------------------------------------------------------------------------
function DurationCard({
  duration,
  standard,
  override,
  onOverride,
  buffer,
  onBuffer,
}: {
  duration: number | null;
  standard: number | null;
  override: number | null;
  onOverride: (n: number | null) => void;
  buffer: number;
  onBuffer: (n: number | null) => void;
}) {
  return (
    <Card>
      <Row label="Behandelduur" value={<Text style={{ color: override != null ? colors.warning : colors.text, fontWeight: '700' }}>{formatDuration(duration)}</Text>} />
      {duration == null ? <Notice kind="warning">Duur onbekend: vul hieronder de totale duur in.</Notice> : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm }}>
        <IntInput label="Totale duur (min)" value={override} placeholder={standard != null ? String(standard) : 'bv. 90'} onChange={onOverride} />
        <IntInput label="Buffer na afloop (min)" value={buffer} onChange={(n) => onBuffer(n ?? 0)} />
      </View>
    </Card>
  );
}

function DateTimePickerSection({
  date,
  time,
  onDate,
  onTime,
  duration,
  buffer,
  teamId,
  assigneeId,
  workstationId,
  excludeId,
  accent,
}: {
  date: string;
  time: string | null;
  onDate: (d: string) => void;
  onTime: (t: string | null) => void;
  duration: number | null;
  buffer: number;
  teamId: string | null;
  assigneeId: string | null;
  workstationId: string | null;
  excludeId: string | null;
  accent: string;
}) {
  const [showMonth, setShowMonth] = useState(false);
  const [month, setMonth] = useState(DateTime.fromISO(date).startOf('month').toISODate()!);
  const [manual, setManual] = useState('');
  const today = todayIsoDate();
  const quickDays = Array.from({ length: 14 }, (_, i) => addDays(today, i));

  const slots = useQuery({
    queryKey: ['slots', date, duration, buffer, teamId, assigneeId, workstationId, excludeId],
    enabled: !!duration,
    queryFn: () => fetchAvailableStarts({ date, duration: duration!, buffer, teamId, assigneeId, workstationId, excludeId }),
  });
  const manualCheck = useQuery({
    queryKey: ['check', date, time, duration, buffer, teamId, assigneeId, workstationId, excludeId],
    enabled: !!duration && !!time,
    queryFn: () =>
      fetchBookingProblems({ startsAt: localToUtcIso(date, time!), duration: duration!, buffer, teamId, assigneeId, workstationId, excludeId }),
  });

  return (
    <View>
      <Section title="Datum" right={<Text style={{ color: accent }} onPress={() => setShowMonth(!showMonth)}>{showMonth ? 'Verberg kalender' : 'Kalender'}</Text>}>
        <Text style={{ color: colors.text, fontSize: 17, fontWeight: '700', marginBottom: space.sm }}>{formatDateLong(date)}</Text>
        {showMonth ? (
          <MonthGrid month={month} onChangeMonth={setMonth} selected={date} accent={accent} onSelect={(d) => { onDate(d); setShowMonth(false); }} />
        ) : (
          <ChipRow scroll>
            {quickDays.map((d, i) => (
              <Chip key={d} label={i === 0 ? 'Vandaag' : i === 1 ? 'Morgen' : formatDateShort(d)} selected={d === date} onPress={() => onDate(d)} />
            ))}
          </ChipRow>
        )}
      </Section>

      <Section title="Beschikbare starttijden">
        {!duration ? (
          <T.Muted>Vul eerst de behandelduur in.</T.Muted>
        ) : slots.isLoading ? (
          <Loading label="Vrije tijden ophalen…" />
        ) : slots.error ? (
          <Notice kind="danger">{toFriendlyError(slots.error).message}</Notice>
        ) : (slots.data ?? []).length === 0 ? (
          <Notice kind="warning">Geen vrije starttijd op deze dag voor {formatDuration(duration)} (incl. buffer, pauzes, blokkades en capaciteit).</Notice>
        ) : (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {(slots.data ?? []).map((iso) => {
              const t = formatTime(iso);
              return <Chip key={iso} label={t} selected={time === t} onPress={() => onTime(t)} />;
            })}
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-end', marginTop: space.md }}>
          <Field label="Of typ een tijd (UU:MM)" value={manual} onChangeText={setManual} placeholder="10:30" keyboardType="numbers-and-punctuation" style={{ flex: 1, marginBottom: 0 }} />
          <Button title="Kies" variant="secondary" onPress={() => isTime(manual) && onTime(manual.trim())} disabled={!isTime(manual)} />
        </View>
        {time ? (
          manualCheck.data && manualCheck.data.length ? (
            <Notice kind="warning">
              {time}: {manualCheck.data.map((p) => p.message).join(' ')}
            </Notice>
          ) : manualCheck.data ? (
            <Notice kind="success">✓ {time} is beschikbaar</Notice>
          ) : null
        ) : null}
      </Section>
    </View>
  );
}
