// Afspraak aanmaken én bewerken/verplaatsen (met ?id=...).
// Stappen: klant → auto → behandeling(en) → planning → controle & opslaan.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { DateTime } from 'luxon';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, TextInput, View } from 'react-native';
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
import { colors, space, statusColors } from '../../../theme';

const STEPS = ['Klant', 'Auto', 'Behandeling', 'Planning', 'Controle'];

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
  const { isOwner } = useAuth();

  const settings = useSettings();
  const catalog = useCatalog();
  const teams = useTeams();
  const profiles = useProfiles();
  const workstations = useWorkstations();
  const existing = useAppointment(editId);
  const save = useSaveAppointment();

  const requestId = useRef(Crypto.randomUUID());
  const [step, setStep] = useState(0);
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
    setStep(params.stap === 'planning' ? 3 : 4);
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
      setStep(2);
    } else setStep(1);
  }, [preCustomer.data, customer, params.vehicleId]);

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

  if (!initialized || catalog.isLoading || settings.isLoading) return <Loading />;
  if (catalog.error) return <Loading label="Catalogus laden mislukt — controleer de verbinding." />;

  // ---------------------------------------------------------------------------
  const canNext = [
    !!customer,
    vehicleSkipped || !!vehicleId || !!vehicle,
    selections.length > 0,
    !!time && !!effectiveDuration,
    true,
  ][step];

  const startsAtIso = time ? localToUtcIso(date, time) : null;
  const endIso = startsAtIso && effectiveDuration ? new Date(new Date(startsAtIso).getTime() + effectiveDuration * 60000).toISOString() : null;

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

  return (
    <>
      <Stack.Screen options={{ title: isEdit ? 'Afspraak wijzigen' : 'Nieuwe afspraak' }} />
      <Screen
        footer={
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {step > 0 ? <Button title="Vorige" variant="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
            {step < 4 ? (
              <Button title="Volgende" onPress={() => setStep(step + 1)} disabled={!canNext} style={{ flex: 2 }} big />
            ) : (
              <Button
                title={isEdit ? 'Wijziging opslaan' : 'Afspraak opslaan'}
                onPress={() => doSave()}
                loading={save.isPending}
                disabled={!customer || !time || !effectiveDuration}
                style={{ flex: 2 }}
                big
              />
            )}
          </View>
        }
      >
        <ChipRow scroll>
          {STEPS.map((s, i) => (
            <Chip key={s} label={`${i + 1}. ${s}`} selected={i === step} onPress={() => (i <= step || isEdit ? setStep(i) : undefined)} disabled={i > step && !isEdit} />
          ))}
        </ChipRow>
        <View style={{ height: space.md }} />

        {step === 0 ? <CustomerStep value={customer} onChange={(c) => { setCustomer(c); if (c && !isEdit) { setVehicleId(null); setVehicle(null); } }} /> : null}
        {step === 1 && customer ? (
          <VehicleStep
            customerId={customer.id}
            vehicleId={vehicleId}
            draft={vehicle}
            skipped={vehicleSkipped}
            onSelect={(id, draft) => {
              setVehicleId(id);
              setVehicle(draft);
              setVehicleSkipped(false);
            }}
            onSkip={() => {
              setVehicleId(null);
              setVehicle(null);
              setVehicleSkipped(true);
            }}
          />
        ) : null}
        {step === 2 ? (
          <ServicesStep
            selections={selections}
            onChange={changeSelections}
            quote={quote}
            snapshot={snapshot}
            vehicleInput={vehicleInput}
            filmPercentages={settings.data?.film_percentages ?? []}
          />
        ) : null}
        {step === 3 ? (
          <View>
            <DurationCard
              duration={effectiveDuration}
              standard={snapshot ? snapshot.duration_min : quote?.standardDurationMin ?? null}
              override={durationOverride}
              onOverride={setDurationOverride}
              buffer={effectiveBuffer}
              onBuffer={setBufferMin}
            />
            <Section title="Uitvoerende partij">
              <ChipRow>
                {(teams.data ?? [])
                  .filter((t) => t.active || t.id === teamId)
                  .map((t) => (
                    <Chip key={t.id} label={t.name} color={t.color} selected={teamId === t.id} onPress={() => setTeamId(t.id)} />
                  ))}
                <Chip label="Niet toegewezen" color={UNASSIGNED_COLOR} selected={!teamId} onPress={() => setTeamId(null)} />
              </ChipRow>
            </Section>
            <Section title="Medewerker (optioneel)">
              <ChipRow>
                <Chip label="Geen" selected={!assigneeId} onPress={() => setAssigneeId(null)} />
                {(profiles.data ?? [])
                  .filter((p) => p.active || p.id === assigneeId)
                  .map((p) => (
                    <Chip key={p.id} label={p.display_name} selected={assigneeId === p.id} onPress={() => setAssigneeId(p.id)} />
                  ))}
              </ChipRow>
            </Section>
            {(workstations.data ?? []).some((w) => w.active) ? (
              <Section title="Werkplek (optioneel)">
                <ChipRow>
                  <Chip label="Geen" selected={!workstationId} onPress={() => setWorkstationId(null)} />
                  {(workstations.data ?? [])
                    .filter((w) => w.active || w.id === workstationId)
                    .map((w) => (
                      <Chip key={w.id} label={w.name} selected={workstationId === w.id} onPress={() => setWorkstationId(w.id)} />
                    ))}
                </ChipRow>
              </Section>
            ) : null}
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
          </View>
        ) : null}
        {step === 4 ? (
          <View>
            <Card>
              <T.H2>{customer?.name}</T.H2>
              <T.Muted>{customer?.phone ?? 'Geen telefoonnummer'}</T.Muted>
              <T.Muted style={{ marginTop: space.xs }}>
                {vehicle ? [vehicle.make, vehicle.model, vehicle.variant, vehicle.build_year, vehicle.plate].filter(Boolean).join(' ') || 'Auto' : 'Auto onbekend'}
              </T.Muted>
            </Card>
            <Card>
              <Row label="Datum" value={formatDateLong(date)} />
              <Row label="Tijd" value={time && endIso ? `${time} – ${formatTime(endIso)}` : 'Kies een tijd'} />
              <Row label="Duur" value={`${formatDuration(effectiveDuration)}${(snapshot ? durationOverride != null : quote?.durationOverridden) ? ' (aangepast)' : ''}`} />
              <Row label="Buffer na afloop" value={`${effectiveBuffer} min`} />
              <Row label="Uitvoerende partij" value={<TeamBadge team={(teams.data ?? []).find((t) => t.id === teamId)} />} />
              {assigneeId ? <Row label="Medewerker" value={(profiles.data ?? []).find((p) => p.id === assigneeId)?.display_name ?? ''} /> : null}
              {workstationId ? <Row label="Werkplek" value={(workstations.data ?? []).find((w) => w.id === workstationId)?.name ?? ''} /> : null}
            </Card>
            <PriceSummary quote={quote} snapshot={snapshot} />
            {isEdit ? (
              <Section title="Status">
                <ChipRow>
                  {STATUSES.map((s) => (
                    <Chip key={s.value} label={s.label} color={statusColors[s.value]} selected={status === s.value} onPress={() => setStatus(s.value)} />
                  ))}
                </ChipRow>
              </Section>
            ) : null}
            <Section title="Interne opmerkingen">
              <Field label="Alleen zichtbaar voor het team" value={notes} onChangeText={setNotes} multiline />
            </Section>
            {saveError ? (
              <Notice kind="danger">
                {saveError.title}: {saveError.message}
                {saveError.problems?.length ? '\n• ' + saveError.problems.map((p) => p.message).join('\n• ') : ''}
              </Notice>
            ) : null}
            {saveError?.kind === 'rules' && isOwner && saveError.problems?.every((p) => p.overridable) ? (
              <Button title="Toch opslaan (bewuste uitzondering)" variant="danger" onPress={() => setForcePrompt(true)} />
            ) : null}
            {saveError?.kind === 'rules' ? (
              <Button title="Ander tijdstip kiezen" variant="secondary" onPress={() => setStep(3)} style={{ marginTop: space.sm }} />
            ) : null}
          </View>
        ) : null}
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
  onSelect: (id: string | null, d: VehicleDraft) => void;
  onSkip: () => void;
}) {
  const c = useCustomer(customerId);
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
    onSelect(data.id, rowToDraft(data));
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
        <Card key={v.id} onPress={() => onSelect(v.id, rowToDraft(v))} style={vehicleId === v.id ? { borderColor: colors.info, borderWidth: 2 } : undefined}>
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
        <Section title="Gegevens voor deze afspraak">
          <T.Muted style={{ marginBottom: space.sm }}>Aanpassingen hier gelden voor de prijsberekening van deze afspraak.</T.Muted>
          <VehicleForm value={draft} onChange={(d) => onSelect(vehicleId, d)} />
        </Section>
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

  return (
    <View>
      {snapshot ? (
        <Notice>
          Prijzen en tijden zijn vastgelegd bij het boeken. Pas je hier iets aan, dan wordt opnieuw berekend met de huidige catalogus.
        </Notice>
      ) : null}
      {!vehicleInput.body_type ? <Notice kind="warning">Carrosserie onbekend: prijzen kunnen nog niet automatisch bepaald worden.</Notice> : null}
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
                <T.Muted>
                  Standaard: {formatEuro(line.standardPriceCents)} · {formatDuration(line.standardDurationMin)}
                  {line.ruleLabel ? ` (${line.ruleLabel})` : ''}
                </T.Muted>
                {line.exceptionLabel ? <Text style={{ color: colors.info, marginTop: 2 }}>Modeluitzondering: {line.exceptionLabel}</Text> : null}
                {line.bundleLabel ? <Text style={{ color: colors.info, marginTop: 2 }}>Pakket: {line.bundleLabel}</Text> : null}
                {line.notes.map((n) => (
                  <Text key={n} style={{ color: colors.warning, marginTop: 2 }}>
                    {n}
                  </Text>
                ))}
              </>
            ) : null}

            {exceptions.length ? (
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
          </Card>
        );
      })}
      {selections.length ? <PriceSummary quote={quote} snapshot={snapshot} /> : <T.Muted style={{ marginTop: space.md }}>Kies één of meer behandelingen.</T.Muted>}
    </View>
  );
}

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
            value={`${formatEuro(i.price_cents)}${i.discount_cents ? ` − ${formatEuro(i.discount_cents)}` : ''}`}
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
                {formatEuro(l.priceCents)}
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
