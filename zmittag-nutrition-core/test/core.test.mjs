import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTargets as calc, calculateEnergy, STANDARDS, SOURCES, NUTRIENTS } from '../core.mjs';

const profile = { ageYears: 30, sex: 'male', weightKg: 75, heightCm: 180, activity: { pal: 1.6 },
  training: { weeklyHours: 6, carbohydrateLoad: 'moderate' } };
const allocation = { kind: 'explicit', lunch: .4, dinner: .3 };
const request = (standard, overrides = {}) => ({ standard, profile, allocation, ...overrides });
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
const amount = (r, k, type, meal = 'daily') => r[meal][k].references.find(x => x.referenceType === type)?.amount;

test('NASEM adult published equations, PA boundary and no second PAL multiplier', () => {
  close(calculateEnergy({ method: 'nasem2023', profile }).references[0].amount.low, 2871.07);
  const f = { ...profile, sex: 'female', weightKg: 60, heightCm: 165, activity: { pal: 1.53 } };
  close(calculateEnergy({ method: 'nasem2023', profile: f }).references[0].amount.low, 2182.87);
  assert.equal(calculateEnergy({ method: 'nasem2023', profile: { ...profile, activity: { pal: 1.529999 } } }).references[0].activityCategory, 'inactive');
  assert.throws(() => calculateEnergy({ method: 'nasem2023', profile: { ...profile, activity: { pal: 2.5 } } }), RangeError);
});

test('age 18 is not silently processed with the >=19 equations or macro/fibre rows', () => {
  const p = { ...profile, ageYears: 18, sex: 'female', weightKg: 60, heightCm: 165, activity: { pal: 1.56 } };
  const r = calc(request('us_nasem', { profile: p }));
  close(amount(r, 'kcal', 'individual_EER').low, -297.54 - 22.25 * 18 + 12.77 * 165 + 14.73 * 60 + 20);
  close(amount(r, 'protein', 'RDA').low, 51);
  assert.equal(r.daily.fat.references[0].energyFraction.low, .25);
  assert.equal(amount(r, 'fiber', 'AI').low, 26);
  const d = calc(request('dge_oege', { profile: { ...profile, ageYears: 18 } }));
  assert.equal(d.daily.kcal.references[0].amount.low, 3000);
  close(d.daily.protein.references[0].amount.low, 67.5);
  assert.equal(d.daily.fiber.status, 'not_defined');
});

test('EFSA uses published kcal rather than converting rounded MJ; >=80 remains undefined', () => {
  const p = { ...profile, ageYears: 20, activity: { pal: 1.4 } };
  assert.equal(calc(request('efsa', { profile: p })).daily.kcal.references[0].amount.low, 2338);
  assert.notEqual(9.8 * 1000 / 4.184, 2338);
  assert.equal(calc(request('efsa', { profile: { ...p, ageYears: 80 } })).daily.kcal.status, 'not_defined');
  assert.throws(() => calc(request('efsa', { profile: { ...p, activity: { pal: 1.5 } } })), RangeError);
});

test('Swiss 65/66 boundary preserves native population uncertainty and older adult references', () => {
  const young = calc(request('ch_blv', { profile: { ...profile, ageYears: 65 } }));
  const old = calc(request('ch_blv', { profile: { ...profile, ageYears: 66 } }));
  assert.deepEqual(young.daily.kcal.references[0].amount, { low: 2305, high: 2672 });
  assert.deepEqual(old.daily.kcal.references[0].amount, { low: 2100, high: 2800 });
  assert.deepEqual(old.daily.protein.references[0].amount, { low: 75, high: 90 });
  assert.deepEqual(old.daily.fiber.references[0].amount, { low: 25, high: 30 });
  assert.deepEqual(old.daily.salt.references[0].sodiumMg, { low: 1200, high: 1500 });
  const cap = old.daily.saturated.references[0];
  assert.equal(cap.kind, 'maximum'); assert.equal(cap.uncertainEnergy, true);
  close(cap.amount.low, 2100 * .1 / 9); close(cap.amount.high, 2800 * .1 / 9);
});

test('China age-specific PAL, protein and sodium rows', () => {
  const expected = [[18, 9, 65, 1500, 2000], [30, 8.58, 65, 1500, 2000],
    [50, 8.16, 65, 1500, 2000], [65, 7.95, 72, 1400, 1900], [75, 7.53, 72, 1400, 1800]];
  for (const [age, mj, protein, ai, pi] of expected) {
    const r = calc(request('cn_dri_2023', { profile: { ...profile, ageYears: age, activity: { cnClass: 'light' } } }));
    close(r.daily.kcal.references[0].amount.low, mj * 1000 / 4.184);
    assert.equal(amount(r, 'protein', 'RNI').low, protein);
    close(amount(r, 'salt', 'AI').low, ai * .0025);
    close(amount(r, 'salt', 'PI').high, pi * .0025);
  }
  const missingHigh = calc(request('cn_dri_2023', { profile: { ...profile, ageYears: 65, activity: { cnClass: 'heavy' } } }));
  assert.equal(missingHigh.daily.kcal.status, 'not_defined');
  assert.equal(missingHigh.daily.protein.status, 'partial');
  assert.throws(() => calc(request('cn_dri_2023', { profile: { ...profile, activity: { pal: 1.6 } } })), RangeError);
  assert.throws(() => calc(request('cn_dri_2023', { profile: { ...profile, activity: { pal: 1.7, cnClass: 'light' } } })), RangeError);
});

test('shared normal reference weight is explicit for overweight, while training uses actual weight', () => {
  const p = { ...profile, weightKg: 100 };
  assert.equal(calc(request('dge_oege', { profile: p })).daily.protein.status, 'requires_input');
  const r = calc(request('dge_oege', { profile: { ...p, referenceWeightKg: 75 } }));
  close(r.daily.protein.references[0].amount.low, 60);
  close(calc(request('issn', { profile: p })).daily.protein.references[0].amount.low, 140);
});

test('meal shares do not normalize away the unrecorded breakfast/snack remainder', () => {
  const r = calc(request('efsa'));
  close(r.allocation.unallocated, .3);
  for (const k of NUTRIENTS) for (let i = 0; i < r.daily[k].references.length; i++) {
    const d = r.daily[k].references[i], l = r.lunch[k].references[i], n = r.dinner[k].references[i];
    close(l.amount.low, d.amount.low * .4); close(n.amount.high, d.amount.high * .3);
    close(l.amount.low + n.amount.low, d.amount.low * .7);
  }
  assert.throws(() => calc(request('efsa', { allocation: { kind: 'explicit', lunch: .6, dinner: .5 } })), RangeError);
});

test('no hidden meal fractions, and native DGA sugar remains 10 g per meal without allocation', () => {
  const general = calc(request('efsa', { allocation: undefined }));
  assert.equal(general.allocation, null);
  assert.equal(general.lunch.protein.status, 'requires_input');
  assert.equal(general.lunch.protein.references.length, 0);
  for (const a of [undefined, allocation, { kind: 'dge_quarters' }]) {
    const r = calc(request('us_dga_2025', { allocation: a }));
    assert.equal(r.lunch.sugar.references[0].amount.high, 10);
    assert.equal(r.dinner.sugar.references[0].amount.high, 10);
    assert.equal(r.daily.sugar.references[0].period, 'meal');
    assert.equal(r.lunch.sugar.status, 'not_comparable');
  }
});

test('salt AI and CDRR remain separate semantic references with correct label conversion', () => {
  const r = calc(request('us_nasem'));
  assert.equal(amount(r, 'salt', 'AI').low, 3.75);
  assert.equal(amount(r, 'salt', 'CDRR').high, 5.75);
  assert.equal(r.daily.salt.references[1].kind, 'reduction_threshold');
  close(r.lunch.salt.references[1].sodiumMg.high, 920);
});

test('sugar analyte mismatch and standards without numeric saturated-fat caps stay explicit', () => {
  for (const s of ['efsa', 'dge_oege', 'ch_blv', 'us_nasem', 'cn_dri_2023', 'us_dga_2025', 'who']) {
    const p = s === 'cn_dri_2023' ? { ...profile, activity: { cnClass: 'light' } } : profile;
    const r = calc(request(s, { profile: p, energy: { method: 'provided', kcal: 2000, label: 'test energy' } }));
    assert.equal(r.daily.sugar.status, 'not_comparable');
    for (const ref of r.daily.sugar.references) assert.notEqual(ref.analyte, 'total_sugars');
  }
  assert.equal(calc(request('efsa')).daily.saturated.status, 'qualitative');
  assert.equal(calc(request('us_nasem')).daily.saturated.references.length, 0);
});

test('sports load and per-dose alternatives are not conflated with meal allocation or absorption limits', () => {
  const low = calc(request('dge_sport', { profile: { ...profile, training: { weeklyHours: 5 } } }));
  assert.equal(low.daily.protein.status, 'out_of_scope');
  const high = calc(request('dge_sport'));
  close(high.daily.protein.references[0].amount.low, 90);
  const acsm = calc(request('acsm'));
  assert.deepEqual(acsm.daily.carbs.references[0].amount, { low: 375, high: 525 });
  const native = calc(request('issn', { allocation: undefined, proteinMealStrategy: 'issn_weight_dose' }));
  close(native.lunch.protein.references[0].amount.low, 18.75);
  assert.equal(native.lunch.protein.references.length, 1);
  const absolute = calc(request('issn', { proteinMealStrategy: 'issn_absolute_dose' }));
  assert.deepEqual(absolute.dinner.protein.references[0].amount, { low: 20, high: 40 });
});

test('NICE and S3 deficits are explicit, retain ranges and do not invent full nutrient prescriptions', () => {
  const e = { method: 'provided', kcal: 2400, label: 'maintenance' };
  const n = calc(request('nice_ng246', { energy: e, clinicalPlan: { kind: 'deficit_kcal', amount: 400 } }));
  assert.equal(n.daily.kcal.references[0].amount.low, 2000);
  assert.equal(n.daily.protein.status, 'not_defined');
  assert.equal(calc(request('nice_ng246', { energy: e })).daily.kcal.status, 'requires_input');
  const d = calc(request('dag_s3_2024', { energy: e, clinicalPlan: { kind: 'guideline_deficit' } }));
  assert.deepEqual(d.daily.kcal.references[0].amount, { low: 1800, high: 1900 });
  assert.equal(d.daily.sugar.status, 'not_comparable');
  assert.equal(d.daily.sugar.references[0].analyte, 'free_sugars');
  assert.equal(d.daily.protein.status, 'qualitative');
  const orientation = calc(request('dag_s3_2024', { energy: e, clinicalPlan: { kind: 'guideline_deficit' },
    profile: { ...profile, ageYears: 65 }, s3MacroPolicy: 'dge_physically_active' }));
  close(orientation.daily.protein.references[0].amount.low, 60);
  assert.equal(orientation.daily.fat.references[0].energyFraction.high, .35);
  assert.throws(() => calc(request('nice_ng246', { energy: e, clinicalPlan: { kind: 'deficit_kcal', amount: 3000 } })), RangeError);
});

test('all five NHC obesity energy branches and 3:4:3 allocation remain distinct', () => {
  const base = request('cn_obesity_2024', { profile: { ...profile, weightKg: 100 },
    energy: { method: 'provided', kcal: 2400, label: 'maintenance' }, allocation: { kind: 'cn_obesity_343' } });
  const check = (clinicalPlan, expected) => {
    const r = calc({ ...base, clinicalPlan }); assert.deepEqual(r.daily.kcal.references[0].amount, expected); return r;
  };
  check({ kind: 'guideline_deficit' }, { low: 1400, high: 1900 });
  check({ kind: 'guideline_fraction' }, { low: 1200, high: 1680 });
  check({ kind: 'sex_band' }, { low: 1200, high: 1500 });
  check({ kind: 'bmi_reduction', restingKcal: 1600 }, { low: 1920, high: 1920 });
  const r = check({ kind: 'ideal_weight', activity: 'light', kcalPerIdealKg: { low: 20, high: 25 } }, { low: 1500, high: 1875 });
  close(r.lunch.kcal.references[0].amount.low, 600); close(r.dinner.kcal.references[0].amount.high, 562.5);
  assert.equal(r.daily.sugar.references[0].amount.high, 25);
  assert.equal(r.daily.fiber.status, 'qualitative');
  assert.throws(() => calc({ ...base, clinicalPlan: { kind: 'bmi_reduction', restingKcal: 1950 } }), RangeError);
  const normalWeight = calc({ ...base, profile, clinicalPlan: { kind: 'sex_band' } });
  assert.ok(Object.values(normalWeight.daily).every(m => m.status === 'out_of_scope'));
});

test('using planned energy with a regional reference does not reduce fixed fibre/sodium or protein PRI', () => {
  const r = calc(request('efsa', { energy: { method: 'provided', kcal: 1800, label: 'separately planned energy' } }));
  close(r.daily.protein.references[0].amount.low, 62.25);
  assert.equal(r.daily.fiber.references[0].amount.low, 25);
  assert.equal(r.daily.salt.references[0].amount.low, 5);
  close(r.daily.fat.references[0].amount.high, 70);
});

test('original Mifflin coefficients and independently selected Henry method', () => {
  const m = calculateEnergy({ method: 'mifflin1990', profile });
  close(m.references[0].restingKcal, 9.99 * 75 + 6.25 * 180 - 4.92 * 30 + 166 - 161);
  const h = calculateEnergy({ method: 'henry2005', profile });
  close(h.references[0].amount.low, (.0476 * 75 + 2.26 * 1.8 - .574) * 1000 / 4.184 * 1.6);
  close(calculateEnergy({ method: 'henry2005', profile: { ...profile, ageYears: 60 } }).references[0].amount.low,
    (.0476 * 75 + 2.26 * 1.8 - .574) * 1000 / 4.184 * 1.6);
  close(calculateEnergy({ method: 'henry2005', profile: { ...profile, ageYears: 61 } }).references[0].amount.low,
    (.0478 * 75 + 2.26 * 1.8 - 1.070) * 1000 / 4.184 * 1.6);
  assert.equal(calculateEnergy({ method: 'mifflin1990', profile: { ...profile, ageYears: 18 } }).status, 'out_of_scope');
});

test('invalid inputs, missing inputs and unsupported populations have different outcomes', () => {
  for (const bad of [{ weightKg: NaN }, { weightKg: -1 }, { ageYears: 30.5 }, { sex: 'other' }, { pregnant: 'false' }])
    assert.throws(() => calc(request('efsa', { profile: { ...profile, ...bad } })));
  const noWeight = calc(request('efsa', { profile: { ageYears: 30, sex: 'male', activity: { pal: 1.6 } } }));
  assert.equal(noWeight.daily.protein.status, 'requires_input');
  assert.equal(noWeight.daily.fiber.status, 'ok');
  for (const bad of [{ ageYears: 17 }, { pregnant: true }, { lactating: true }, { requiresTherapeuticDiet: true }]) {
    const r = calc(request('efsa', { profile: { ...profile, ...bad } }));
    assert.ok(Object.values(r.daily).every(m => m.status === 'out_of_scope'));
  }
});

test('all profiles return eight fields, valid provenance, finite numbers, and no mutation', () => {
  for (const standard of Object.keys(STANDARDS)) {
    const req = request(standard, { energy: { method: 'provided', kcal: 2400, label: 'test maintenance' },
      clinicalPlan: { kind: 'guideline_deficit' } });
    if (standard === 'nice_ng246') req.clinicalPlan = { kind: 'deficit_kcal', amount: 400 };
    const before = JSON.stringify(req), r = calc(req);
    assert.equal(JSON.stringify(req), before);
    for (const period of ['daily', 'lunch', 'dinner']) {
      assert.deepEqual(Object.keys(r[period]), [...NUTRIENTS]);
      for (const m of Object.values(r[period])) for (const ref of m.references) {
        assert.ok(Number.isFinite(ref.amount.low) && Number.isFinite(ref.amount.high));
        assert.ok(ref.amount.low <= ref.amount.high);
        for (const source of ref.sources) assert.ok(SOURCES[source]?.url);
      }
    }
    r.daily.protein.notes.push('consumer mutation');
    assert.ok(!calc(req).daily.protein.notes.includes('consumer mutation'));
  }
});
