import { describe, expect, it } from 'vitest';
import fixture from './catalog.fixture.json';
import {
  Catalog,
  computeQuote,
  formatDuration,
  formatEuro,
  LineSelection,
  suggestHighEntry,
  termMatches,
  VehicleInput,
} from '../pricing';

const catalog = fixture as unknown as Catalog & { hints: { make: string; model: string; high_entry: boolean }[] };
const sid = (code: string) => {
  const s = (fixture.services as { id: string; code: string }[]).find((x) => x.code === code);
  if (!s) throw new Error(code);
  return s.id;
};
const line = (code: string, extra: Partial<LineSelection> = {}): LineSelection => ({ serviceId: sid(code), ...extra });
const withActive = (patch: (c: Catalog) => void): Catalog => {
  const c: Catalog = JSON.parse(JSON.stringify(catalog));
  patch(c);
  return c;
};

const hatch5: VehicleInput = { make: 'Kia', model: 'Picanto', body_type: 'hatchback', door_count: 5, rear_window_count: 5 };

describe('B-stijlprijzen per carrosserie en ramen', () => {
  const cases: [VehicleInput, number][] = [
    [hatch5, 12000],
    [{ body_type: 'hatchback', door_count: 3, rear_window_count: 3 }, 8000],
    [{ body_type: 'hatchback', door_count: 5, rear_window_count: 3 }, 9000],
    [{ body_type: 'station', rear_window_count: 5 }, 13000],
    [{ body_type: 'station', rear_window_count: 7 }, 15000],
    [{ body_type: 'sedan', rear_window_count: 5 }, 14000],
    [{ body_type: 'coupe', rear_window_count: 3 }, 12000],
    [{ body_type: 'suv', rear_window_count: 5 }, 13000],
    [{ body_type: 'suv', rear_window_count: 7 }, 15000],
    [{ body_type: 'bus', rear_window_count: 3 }, 11000],
    [{ body_type: 'bus', rear_window_count: 5 }, 15000],
  ];
  it.each(cases)('%o → %i cent', (v, price) => {
    const q = computeQuote(catalog, v, [line('bstijl')]);
    expect(q.totalPriceCents).toBe(price);
    expect(q.durationMin).toBe(60);
  });

  it('bus met meer dan vijf achterramen: geen vaste prijs → nog te bepalen, niet €0', () => {
    const q = computeQuote(catalog, { body_type: 'bus', rear_window_count: 7 }, [line('bstijl')]);
    expect(q.totalPriceCents).toBeNull();
    expect(q.knownTotalCents).toBe(0);
    expect(q.lines[0].priceCents).toBeNull();
    expect(q.warnings.join(' ')).toMatch(/nog te bepalen/);
    expect(formatEuro(q.totalPriceCents)).toBe('nog te bepalen');
  });

  it('onbekend aantal ramen → nog te bepalen', () => {
    const q = computeQuote(catalog, { body_type: 'station' }, [line('bstijl')]);
    expect(q.totalPriceCents).toBeNull();
  });
});

describe('modeluitzonderingen vervangen de basisprijs', () => {
  it('Golf 5 B-stijl = €150 / 90 min (niet €120 + €150)', () => {
    const q = computeQuote(catalog, { ...hatch5, make: 'Volkswagen', model: 'Golf 5' }, [line('bstijl')]);
    expect(q.totalPriceCents).toBe(15000);
    expect(q.durationMin).toBe(90);
    expect(q.lines[0].exceptionLabel).toMatch(/Golf 5/);
  });
  it('Golf 6 via model + uitvoering ("Golf", "VI")', () => {
    const q = computeQuote(catalog, { ...hatch5, make: 'volkswagen', model: 'Golf', variant: 'VI 1.4 TSI' }, [line('bstijl')]);
    expect(q.totalPriceCents).toBe(15000);
  });
  it('Golf 7 valt niet onder de uitzondering', () => {
    const q = computeQuote(catalog, { ...hatch5, make: 'Volkswagen', model: 'Golf 7' }, [line('bstijl')]);
    expect(q.totalPriceCents).toBe(12000);
    expect(q.lines[0].exceptionId).toBeNull();
  });
  it('Nissan Micra alleen bouwjaar 2003', () => {
    const v = { ...hatch5, make: 'Nissan', model: 'Micra' };
    expect(computeQuote(catalog, { ...v, build_year: 2003 }, [line('bstijl')]).totalPriceCents).toBe(15000);
    expect(computeQuote(catalog, { ...v, build_year: 2010 }, [line('bstijl')]).totalPriceCents).toBe(12000);
    expect(computeQuote(catalog, v, [line('bstijl')]).totalPriceCents).toBe(12000);
  });
  it('Peugeot 307 station = €250 / 120 min', () => {
    const q = computeQuote(catalog, { make: 'Peugeot', model: '307', body_type: 'station', rear_window_count: 5 }, [line('bstijl')]);
    expect(q.totalPriceCents).toBe(25000);
    expect(q.durationMin).toBe(120);
  });
  it('uitzondering kan handmatig worden uitgezet', () => {
    const q = computeQuote(catalog, { ...hatch5, make: 'Volkswagen', model: 'Golf 5' }, [line('bstijl', { modelExceptionId: null })]);
    expect(q.totalPriceCents).toBe(12000);
  });
  it('inactieve Tesla-uitzondering (te bevestigen) wordt niet toegepast', () => {
    const q = computeQuote(catalog, { make: 'Tesla', model: 'Model 3', body_type: 'sedan', rear_window_count: 5 }, [line('bstijl')]);
    expect(q.lines[0].exceptionId).toBeNull();
    expect(q.totalPriceCents).toBe(14000);
  });
});

describe('voorruit: gewone of hoge instap', () => {
  it('kameleon personenauto €130, hoge instap €150', () => {
    expect(computeQuote(catalog, { ...hatch5, high_entry: false }, [line('kameleon_voorruit')]).totalPriceCents).toBe(13000);
    expect(computeQuote(catalog, { body_type: 'suv', high_entry: true }, [line('kameleon_voorruit')]).totalPriceCents).toBe(15000);
  });
  it('bus is automatisch hoge instap', () => {
    expect(computeQuote(catalog, { body_type: 'bus' }, [line('kameleon_voorruit')]).totalPriceCents).toBe(15000);
    expect(computeQuote(catalog, { body_type: 'bus' }, [line('keramisch_voorruit')]).totalPriceCents).toBe(14000);
  });
  it('onbekende instap → vraag om keuze, geen prijs', () => {
    const q = computeQuote(catalog, { body_type: 'suv' }, [line('keramisch_voorruit')]);
    expect(q.totalPriceCents).toBeNull();
    expect(q.lines[0].notes.join()).toMatch(/hoge instap/);
  });
  it('keramisch: duur nog niet vastgelegd → onbekend', () => {
    const q = computeQuote(catalog, { ...hatch5, high_entry: false }, [line('keramisch_voorruit')]);
    expect(q.totalPriceCents).toBe(12000);
    expect(q.durationMin).toBeNull();
  });
  it('suggestie hoge instap uit modellijst', () => {
    expect(suggestHighEntry(catalog.hints, { make: 'BMW', model: 'X3' })).toBe(true);
    expect(suggestHighEntry(catalog.hints, { make: 'Audi', model: 'Q7 e-tron' })).toBe(true);
    expect(suggestHighEntry(catalog.hints, { make: 'Volkswagen', model: 'T-Roc' })).toBe(false);
    expect(suggestHighEntry(catalog.hints, { make: 'Nissan', model: 'Juke' })).toBe(false);
    expect(suggestHighEntry(catalog.hints, { make: 'Fiat', model: 'Ducato', body_type: 'bus' })).toBe(true);
    expect(suggestHighEntry(catalog.hints, { make: 'Fiat', model: 'Panda' })).toBeNull();
  });
});

describe('voorportieren en combinatiekorting', () => {
  it('personenauto €70, bus €80, bus vier ramen €90', () => {
    expect(computeQuote(catalog, hatch5, [line('voorportieren')]).totalPriceCents).toBe(7000);
    expect(computeQuote(catalog, { body_type: 'bus' }, [line('voorportieren')]).totalPriceCents).toBe(8000);
    expect(computeQuote(catalog, { body_type: 'bus', front_window_count: 4 }, [line('voorportieren')]).totalPriceCents).toBe(9000);
    expect(computeQuote(catalog, hatch5, [line('voorportieren')]).durationMin).toBe(45);
  });
  it('korting staat standaard uit (te bevestigen) en wordt niet willekeurig toegepast', () => {
    const q = computeQuote(catalog, hatch5, [line('bstijl'), line('voorportieren')]);
    expect(q.discountTotalCents).toBe(0);
    expect(q.totalPriceCents).toBe(12000 + 7000);
  });
  const active = withActive((c) => c.discounts.forEach((d) => (d.active = true)));
  it('na activeren: €10 korting → voorportieren €60 bij combinatie', () => {
    const q = computeQuote(active, hatch5, [line('bstijl'), line('voorportieren')]);
    expect(q.discountTotalCents).toBe(1000);
    const vp = q.lines.find((l) => l.serviceId === sid('voorportieren'))!;
    expect(vp.priceCents! - vp.discountCents).toBe(6000);
    expect(vp.discountLabel).toMatch(/Combinatiekorting/);
    expect(q.totalPriceCents).toBe(12000 + 6000);
  });
  it('geen korting zonder combinatie of voor bus (zolang niet ingesteld)', () => {
    expect(computeQuote(active, hatch5, [line('voorportieren')]).discountTotalCents).toBe(0);
    expect(computeQuote(active, { body_type: 'bus', rear_window_count: 3 }, [line('bstijl'), line('voorportieren')]).discountTotalCents).toBe(0);
  });
  it('handmatige korting wordt zichtbaar opgeteld', () => {
    const q = computeQuote(catalog, hatch5, [line('bstijl', { manualDiscountCents: 500, manualDiscountLabel: 'Vaste klant' })]);
    expect(q.totalPriceCents).toBe(11500);
    expect(q.lines[0].discountLabel).toBe('Vaste klant');
  });
});

describe('pakketten en behandeltijden', () => {
  it('standaard B-stijl + kameleon = 120 min, prijs is som', () => {
    const q = computeQuote(catalog, { ...hatch5, high_entry: false }, [line('bstijl'), line('kameleon_voorruit')]);
    expect(q.durationMin).toBe(120);
    expect(q.totalPriceCents).toBe(12000 + 13000);
    expect(q.bundle?.name).toMatch(/B-stijl \+ kameleon/);
  });
  it('Golf 5 + kameleon krijgt NIET automatisch de pakketduur (90 + 60)', () => {
    const q = computeQuote(catalog, { ...hatch5, make: 'Volkswagen', model: 'Golf 5', high_entry: false }, [line('bstijl'), line('kameleon_voorruit')]);
    expect(q.bundle).toBeNull();
    expect(q.durationMin).toBe(150);
    expect(q.totalPriceCents).toBe(15000 + 13000);
  });
  it('complete auto: 150 min, prijs nog te bepalen', () => {
    const q = computeQuote(catalog, hatch5, [line('complete_auto')]);
    expect(q.durationMin).toBe(150);
    expect(q.totalPriceCents).toBeNull();
  });
  it('panoramadak: prijs op zicht, handmatige prijs mogelijk en zichtbaar als afwijking', () => {
    const q0 = computeQuote(catalog, hatch5, [line('panoramadak')]);
    expect(q0.totalPriceCents).toBeNull();
    expect(q0.lines[0].notes).toContain('Prijs op zicht.');
    const q = computeQuote(catalog, hatch5, [line('panoramadak', { priceOverrideCents: 9500, durationOverrideMin: 60 })]);
    expect(q.totalPriceCents).toBe(9500);
    expect(q.durationMin).toBe(60);
    expect(q.deviatesFromStandard).toBe(true);
    expect(q.lines[0].priceOverridden).toBe(true);
  });
  it('Tesla-pakket (inactief tot bevestiging) — na activeren €350 / 180 min totaal', () => {
    const tesla = { make: 'Tesla', model: 'Model 3', body_type: 'sedan' as const, rear_window_count: 5 };
    const inactive = computeQuote(catalog, tesla, [line('bstijl'), line('panoramadak')]);
    expect(inactive.bundle).toBeNull();
    expect(inactive.totalPriceCents).toBeNull(); // panoramadak op zicht
    const active = withActive((c) => c.bundles.forEach((b) => (b.active = true)));
    const q = computeQuote(active, tesla, [line('bstijl'), line('panoramadak')]);
    expect(q.bundle?.name).toMatch(/Tesla/);
    expect(q.totalPriceCents).toBe(35000);
    expect(q.durationMin).toBe(180);
    // Pakket geldt niet voor een andere auto
    const other = computeQuote(active, { body_type: 'sedan', rear_window_count: 5, make: 'BMW', model: '3-serie' }, [line('bstijl'), line('panoramadak')]);
    expect(other.bundle).toBeNull();
  });
  it('achterlichten smoken: geen prijs en geen tijd vastgelegd', () => {
    const q = computeQuote(catalog, hatch5, [line('achterlichten')]);
    expect(q.totalPriceCents).toBeNull();
    expect(q.durationMin).toBeNull();
  });
  it('handmatige totale duur overschrijft en is zichtbaar', () => {
    const q = computeQuote(catalog, hatch5, [line('bstijl')], { durationOverrideMin: 75 });
    expect(q.durationMin).toBe(75);
    expect(q.standardDurationMin).toBe(60);
    expect(q.durationOverridden).toBe(true);
    expect(q.deviatesFromStandard).toBe(true);
  });
  it('meerdere behandelingen tellen op', () => {
    const q = computeQuote(catalog, hatch5, [line('bstijl'), line('voorportieren')]);
    expect(q.durationMin).toBe(105);
  });
});

describe('hulpfuncties', () => {
  it('termMatches', () => {
    expect(termMatches('Golf 5 GTI', 'golf 5')).toBe(true);
    expect(termMatches('golf5', 'golf 5')).toBe(true);
    expect(termMatches('Golf 50', 'golf 5')).toBe(false);
    expect(termMatches('Model 3 Long Range', 'model 3')).toBe(true);
  });
  it('formatEuro / formatDuration', () => {
    expect(formatEuro(12000).replace(/\s/g, ' ')).toMatch(/€ ?120/);
    expect(formatEuro(null)).toBe('nog te bepalen');
    expect(formatDuration(150)).toBe('2 u 30 min');
    expect(formatDuration(60)).toBe('1 uur');
    expect(formatDuration(45)).toBe('45 min');
  });
});
