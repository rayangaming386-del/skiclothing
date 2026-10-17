// Prijs- en duurberekening op basis van de beheerbare catalogus.
// Pure functies (geen netwerk), zodat ze los getest kunnen worden.
// Onbekende prijzen/duren zijn `null` ("nog te bepalen") en worden nooit als 0 geteld.

export type BodyType = 'hatchback' | 'station' | 'sedan' | 'coupe' | 'suv' | 'bus';

export const BODY_TYPES: { value: BodyType; label: string }[] = [
  { value: 'hatchback', label: 'Hatchback' },
  { value: 'station', label: 'Station' },
  { value: 'sedan', label: 'Sedan' },
  { value: 'coupe', label: 'Coupé' },
  { value: 'suv', label: 'SUV' },
  { value: 'bus', label: 'Bus' },
];

export interface VehicleInput {
  make?: string | null;
  model?: string | null;
  variant?: string | null;
  build_year?: number | null;
  body_type?: BodyType | null;
  door_count?: number | null;
  rear_window_count?: number | null;
  front_window_count?: number | null;
  high_entry?: boolean | null;
}

export interface Service {
  id: string;
  name: string;
  active: boolean;
  is_windshield: boolean;
  price_on_sight: boolean;
  film_kind?: string | null;
  film_brands?: string[] | null;
  film_percentages?: number[] | null;
  film_colors?: string[] | null;
  sort_order?: number;
}

export interface PriceRule {
  id: string;
  service_id: string;
  label: string;
  body_type: BodyType | null;
  passenger_car_only: boolean;
  high_entry: boolean | null;
  door_count: number | null;
  rear_window_count: number | null;
  front_window_count: number | null;
  price_cents: number | null;
  duration_min: number | null;
  active: boolean;
  sort_order: number;
}

export interface ModelException {
  id: string;
  label: string;
  service_id: string;
  make: string | null;
  match_terms: string[];
  body_type: BodyType | null;
  year_from: number | null;
  year_to: number | null;
  price_cents: number | null;
  duration_min: number | null;
  active: boolean;
}

export interface Bundle {
  id: string;
  name: string;
  service_ids: string[];
  make: string | null;
  match_terms: string[];
  body_type: BodyType | null;
  price_cents: number | null;
  duration_min: number | null;
  active: boolean;
}

export interface DiscountRule {
  id: string;
  name: string;
  target_service_id: string;
  required_any_service_ids: string[];
  body_types: BodyType[] | null;
  amount_cents: number;
  active: boolean;
}

export interface Catalog {
  services: Service[];
  prices: PriceRule[];
  exceptions: ModelException[];
  bundles: Bundle[];
  discounts: DiscountRule[];
}

export interface LineSelection {
  serviceId: string;
  /** undefined = automatisch, null = bewust geen uitzondering, string = deze uitzondering */
  modelExceptionId?: string | null;
  priceOverrideCents?: number | null;
  durationOverrideMin?: number | null;
  manualDiscountCents?: number | null;
  manualDiscountLabel?: string | null;
  filmBrand?: string | null;
  filmPercentage?: number | null;
  filmColor?: string | null;
  measuredVlt?: number | null;
  note?: string | null;
}

export interface QuoteLine {
  serviceId: string;
  serviceName: string;
  ruleLabel: string | null;
  exceptionId: string | null;
  exceptionLabel: string | null;
  bundleId: string | null;
  bundleLabel: string | null;
  standardPriceCents: number | null;
  priceCents: number | null;
  standardDurationMin: number | null;
  durationMin: number | null;
  discountCents: number;
  discountLabel: string | null;
  discountRuleId: string | null;
  priceOverridden: boolean;
  durationOverridden: boolean;
  notes: string[];
  selection: LineSelection;
}

export interface Quote {
  lines: QuoteLine[];
  bundle: { id: string; name: string; priceCents: number | null; durationMin: number | null } | null;
  /** Totaal na korting; null zolang een onderdeel nog geen prijs heeft. */
  totalPriceCents: number | null;
  /** Som van wél bekende prijzen (na korting), voor weergave "€X + nog te bepalen". */
  knownTotalCents: number;
  discountTotalCents: number;
  standardDurationMin: number | null;
  durationMin: number | null;
  durationOverridden: boolean;
  deviatesFromStandard: boolean;
  warnings: string[];
}

const PASSENGER: BodyType[] = ['hatchback', 'station', 'sedan', 'coupe', 'suv'];

export function normalizeText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "golf 5" past op "Golf 5", "golf5 gti", maar niet op "golf 50". */
export function termMatches(haystack: string, term: string): boolean {
  const h = normalizeText(haystack);
  const parts = normalizeText(term).split(' ').filter(Boolean);
  if (!parts.length) return false;
  const re = new RegExp(`(^| )${parts.map(escapeRegExp).join(' ?')}($| )`);
  return re.test(h);
}

function vehicleMatchesFilter(
  v: VehicleInput,
  f: { make: string | null; match_terms: string[]; body_type: BodyType | null; year_from?: number | null; year_to?: number | null },
): boolean {
  if (f.make && normalizeText(f.make) !== normalizeText(v.make)) return false;
  if (f.match_terms.length) {
    const hay = `${v.model ?? ''} ${v.variant ?? ''}`;
    if (!f.match_terms.some((t) => termMatches(hay, t))) return false;
  }
  if (f.body_type && v.body_type !== f.body_type) return false;
  if (f.year_from != null || f.year_to != null) {
    if (v.build_year == null) return false;
    if (f.year_from != null && v.build_year < f.year_from) return false;
    if (f.year_to != null && v.build_year > f.year_to) return false;
  }
  return true;
}

export function effectiveHighEntry(v: VehicleInput): boolean | null {
  if (v.high_entry != null) return v.high_entry;
  if (v.body_type === 'bus') return true;
  return null;
}

/** Meest specifieke actieve prijsregel die past bij het voertuig. */
export function findPriceRule(rules: PriceRule[], serviceId: string, v: VehicleInput): PriceRule | null {
  const highEntry = effectiveHighEntry(v);
  let best: PriceRule | null = null;
  let bestScore = -1;
  for (const r of rules) {
    if (!r.active || r.service_id !== serviceId) continue;
    let score = 0;
    if (r.body_type) {
      if (v.body_type !== r.body_type) continue;
      score++;
    }
    if (r.passenger_car_only) {
      if (!v.body_type || !PASSENGER.includes(v.body_type)) continue;
      score++;
    }
    if (r.high_entry != null) {
      if (highEntry !== r.high_entry) continue;
      score++;
    }
    if (r.door_count != null) {
      if (v.door_count !== r.door_count) continue;
      score++;
    }
    if (r.rear_window_count != null) {
      if (v.rear_window_count !== r.rear_window_count) continue;
      score++;
    }
    if (r.front_window_count != null) {
      if (v.front_window_count !== r.front_window_count) continue;
      score++;
    }
    if (score > bestScore || (score === bestScore && best && r.sort_order < best.sort_order)) {
      best = r;
      bestScore = score;
    }
  }
  return best;
}

export function findModelExceptions(exceptions: ModelException[], serviceId: string, v: VehicleInput): ModelException[] {
  return exceptions.filter((e) => e.active && e.service_id === serviceId && vehicleMatchesFilter(v, e));
}

export function computeQuote(
  catalog: Catalog,
  vehicle: VehicleInput,
  selections: LineSelection[],
  opts: { durationOverrideMin?: number | null } = {},
): Quote {
  const warnings: string[] = [];
  const serviceById = new Map(catalog.services.map((s) => [s.id, s]));
  const selectedIds = new Set(selections.map((s) => s.serviceId));

  const lines: QuoteLine[] = selections.map((sel) => {
    const service = serviceById.get(sel.serviceId);
    const notes: string[] = [];
    const line: QuoteLine = {
      serviceId: sel.serviceId,
      serviceName: service?.name ?? 'Onbekende behandeling',
      ruleLabel: null,
      exceptionId: null,
      exceptionLabel: null,
      bundleId: null,
      bundleLabel: null,
      standardPriceCents: null,
      priceCents: null,
      standardDurationMin: null,
      durationMin: null,
      discountCents: 0,
      discountLabel: null,
      discountRuleId: null,
      priceOverridden: false,
      durationOverridden: false,
      notes,
      selection: sel,
    };
    if (!service) {
      notes.push('Behandeling niet (meer) in de catalogus.');
      return line;
    }

    const rule = findPriceRule(catalog.prices, service.id, vehicle);
    if (rule) {
      line.ruleLabel = rule.label;
      line.standardPriceCents = rule.price_cents;
      line.standardDurationMin = rule.duration_min;
    } else if (service.is_windshield && effectiveHighEntry(vehicle) == null) {
      notes.push('Kies gewone of hoge instap voor de voorruitprijs.');
    } else if (!service.price_on_sight) {
      notes.push('Geen standaardprijs voor deze uitvoering.');
    }

    // Modeluitzondering vervangt de basisprijs/-duur (niet optellen).
    let exception: ModelException | null = null;
    if (sel.modelExceptionId) {
      exception = catalog.exceptions.find((e) => e.id === sel.modelExceptionId) ?? null;
    } else if (sel.modelExceptionId === undefined) {
      const matches = findModelExceptions(catalog.exceptions, service.id, vehicle);
      exception = matches[0] ?? null;
      if (matches.length > 1) {
        warnings.push(`Meerdere modeluitzonderingen passen bij ${service.name}; "${matches[0].label}" is gekozen.`);
      }
    }
    if (exception) {
      line.exceptionId = exception.id;
      line.exceptionLabel = exception.label;
      if (exception.price_cents != null) line.standardPriceCents = exception.price_cents;
      if (exception.duration_min != null) line.standardDurationMin = exception.duration_min;
    }

    if (service.price_on_sight && !exception) {
      line.standardPriceCents = null;
      notes.push('Prijs op zicht.');
    }

    line.priceCents = line.standardPriceCents;
    line.durationMin = line.standardDurationMin;
    return line;
  });

  // Pakketten
  let bundle: Quote['bundle'] = null;
  for (const b of catalog.bundles) {
    if (!b.active || !b.service_ids.every((id) => selectedIds.has(id))) continue;
    const hasVehicleFilter = !!(b.make || b.match_terms.length || b.body_type);
    if (hasVehicleFilter && !vehicleMatchesFilter(vehicle, b)) continue;
    const parts = lines.filter((l) => b.service_ids.includes(l.serviceId));
    if (!hasVehicleFilter && parts.some((l) => l.exceptionId)) {
      warnings.push(`Pakket "${b.name}" niet toegepast vanwege een modeluitzondering; duur is opgeteld.`);
      continue;
    }
    bundle = { id: b.id, name: b.name, priceCents: b.price_cents, durationMin: b.duration_min };
    parts.forEach((l, i) => {
      l.bundleId = b.id;
      l.bundleLabel = b.name;
      if (b.price_cents != null) {
        l.standardPriceCents = i === 0 ? b.price_cents : 0;
        l.priceCents = l.standardPriceCents;
        l.notes = l.notes.filter((n) => n !== 'Prijs op zicht.' && n !== 'Geen standaardprijs voor deze uitvoering.');
        if (i > 0) l.notes.push(`Inbegrepen in pakket "${b.name}".`);
      }
    });
    break; // één pakket per afspraak
  }

  // Handmatige afwijkingen per regel
  for (const l of lines) {
    const sel = l.selection;
    if (sel.priceOverrideCents != null && sel.priceOverrideCents !== l.standardPriceCents) {
      l.priceCents = sel.priceOverrideCents;
      l.priceOverridden = true;
    }
    if (sel.durationOverrideMin != null && sel.durationOverrideMin !== l.standardDurationMin) {
      l.durationMin = sel.durationOverrideMin;
      l.durationOverridden = true;
    }
  }

  // Kortingen (alleen actieve, expliciet ingestelde regels)
  for (const d of catalog.discounts) {
    if (!d.active || !selectedIds.has(d.target_service_id)) continue;
    if (d.required_any_service_ids.length && !d.required_any_service_ids.some((id) => id !== d.target_service_id && selectedIds.has(id))) continue;
    if (d.body_types && (!vehicle.body_type || !d.body_types.includes(vehicle.body_type))) continue;
    const target = lines.find((l) => l.serviceId === d.target_service_id && !l.discountRuleId);
    if (!target || target.priceCents == null) continue;
    target.discountCents += Math.min(d.amount_cents, target.priceCents);
    target.discountLabel = d.name;
    target.discountRuleId = d.id;
  }
  for (const l of lines) {
    const extra = l.selection.manualDiscountCents ?? 0;
    if (extra > 0 && l.priceCents != null) {
      l.discountCents = Math.min(l.priceCents, l.discountCents + extra);
      l.discountLabel = [l.discountLabel, l.selection.manualDiscountLabel || 'Handmatige korting'].filter(Boolean).join(' + ');
    }
  }

  // Totalen
  let knownTotal = 0;
  let complete = lines.length > 0;
  let discountTotal = 0;
  for (const l of lines) {
    discountTotal += l.discountCents;
    if (l.priceCents == null) complete = false;
    else knownTotal += l.priceCents - l.discountCents;
  }

  const sumDur = (pick: (l: QuoteLine) => number | null) => {
    let total = 0;
    for (const l of lines) {
      if (bundle && l.bundleId === bundle.id && bundle.durationMin != null) continue;
      const d = pick(l);
      if (d == null) return null;
      total += d;
    }
    if (bundle && bundle.durationMin != null) total += bundle.durationMin;
    return lines.length ? total : null;
  };
  const standardDuration = sumDur((l) => l.standardDurationMin);
  let duration = sumDur((l) => (l.durationOverridden ? l.durationMin : l.standardDurationMin));
  // Bij een pakketduur telt een handmatige duur van een onderdeel niet mee; overschrijf dan de totale duur.
  let durationOverridden = lines.some((l) => l.durationOverridden && !(bundle && l.bundleId === bundle.id && bundle.durationMin != null));
  if (opts.durationOverrideMin != null && opts.durationOverrideMin > 0 && opts.durationOverrideMin !== duration) {
    duration = opts.durationOverrideMin;
    durationOverridden = true;
  }

  if (!complete && lines.length) warnings.push('Niet alle prijzen zijn bekend: totaal nog te bepalen.');
  if (duration == null && lines.length) warnings.push('Behandelduur onbekend: vul de duur handmatig in.');

  return {
    lines,
    bundle,
    totalPriceCents: complete ? knownTotal : null,
    knownTotalCents: knownTotal,
    discountTotalCents: discountTotal,
    standardDurationMin: standardDuration,
    durationMin: duration,
    durationOverridden,
    deviatesFromStandard: durationOverridden || lines.some((l) => l.priceOverridden || l.durationOverridden),
    warnings,
  };
}

export function suggestHighEntry(
  hints: { make: string; model: string; high_entry: boolean }[],
  v: VehicleInput,
): boolean | null {
  if (v.body_type === 'bus') return true;
  const hit = hints.find((h) => normalizeText(h.make) === normalizeText(v.make) && termMatches(`${v.model ?? ''} ${v.variant ?? ''}`, h.model));
  return hit ? hit.high_entry : null;
}

export function formatEuro(cents: number | null | undefined, unknown = 'nog te bepalen'): string {
  if (cents == null) return unknown;
  const euros = cents / 100;
  return new Intl.NumberFormat('nl-NL', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: Number.isInteger(euros) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(euros);
}

export function formatDuration(min: number | null | undefined): string {
  if (min == null) return 'onbekend';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} u ${m} min` : `${h} uur`;
}

/** Omzetten naar de payload voor save_appointment (momentopname van de berekening). */
export function quoteToItems(q: Quote) {
  return q.lines.map((l) => {
    const service = l.selection;
    return {
      service_id: l.serviceId,
      service_name: l.serviceName,
      price_rule_label: l.ruleLabel,
      model_exception_id: l.exceptionId,
      model_exception_label: l.exceptionLabel,
      bundle_id: l.bundleId,
      bundle_label: l.bundleLabel,
      film_brand: service.filmBrand ?? null,
      film_percentage: service.filmPercentage ?? null,
      film_color: service.filmColor ?? null,
      measured_vlt: service.measuredVlt ?? null,
      standard_price_cents: l.standardPriceCents,
      price_cents: l.priceCents,
      standard_duration_min: l.standardDurationMin,
      duration_min: l.durationMin,
      discount_cents: l.discountCents,
      discount_label: l.discountLabel,
      discount_rule_id: l.discountRuleId,
      price_overridden: l.priceOverridden,
      duration_overridden: l.durationOverridden,
      note: service.note ?? null,
    };
  });
}
