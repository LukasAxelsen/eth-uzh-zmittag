import { SOURCES, CN_2023, NASEM_2023, NASEM_18, HENRY_WEIGHT_HEIGHT_MJ, EFSA_ENERGY } from './reference-data.mjs';

export { SOURCES } from './reference-data.mjs';
export { createHallModel, estimateHallFatMass, hallWeight, hallDerivatives,
  simulateHall, planHallEnergy, HALL_CONSTANTS } from './hall.mjs';

export const VERSION = '1.0.0';
export const NUTRIENTS = Object.freeze(['kcal', 'protein', 'fat', 'saturated', 'carbs', 'sugar', 'salt', 'fiber']);
export const STANDARDS = Object.freeze({
  efsa: 'EFSA DRVs', dge_oege: 'DGE/ÖGE', ch_blv: 'Swiss BLV', cn_dri_2023: 'China DRIs 2023',
  us_nasem: 'NASEM DRI + 2023 EER', us_dga_2025: 'DGA 2025–2030', who: 'WHO',
  dge_sport: 'DGE sport 2020', issn: 'ISSN protein 2017', acsm: 'AND/DC/ACSM 2016',
  nice_ng246: 'NICE NG246', dag_s3_2024: 'German S3 obesity 2024', cn_obesity_2024: 'China NHC obesity 2024'
});
const ANALYTES = { kcal: 'energy', protein: 'protein', fat: 'total_fat', saturated: 'saturated_fat',
  carbs: 'available_carbohydrate', sugar: 'total_sugars', salt: 'label_salt_equivalent', fiber: 'dietary_fibre' };
const PA = ['inactive', 'low_active', 'active', 'very_active'];
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const clone = x => JSON.parse(JSON.stringify(x));
function finite(x, name, min = -Infinity, max = Infinity) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min || x > max)
    throw new RangeError(`${name} must be finite and in [${min}, ${max}]`);
  return x;
}
function positive(x, name) { finite(x, name); if (x <= 0) throw new RangeError(`${name} must be > 0`); return x; }
function interval(x, name, strictlyPositive = false) {
  const a = typeof x === 'number' ? { low: x, high: x } : x;
  if (!a || typeof a !== 'object') throw new TypeError(`${name} must be a number or {low, high}`);
  finite(a.low, `${name}.low`); finite(a.high, `${name}.high`);
  if (a.low > a.high || (strictlyPositive && a.low <= 0)) throw new RangeError(`${name} is not an ordered positive interval`);
  return { low: a.low, high: a.high };
}
const multiply = (a, f) => ({ low: a.low * f, high: a.high * f });
function metric(k, status = 'not_defined', notes = []) {
  return { unit: k === 'kcal' ? 'kcal' : 'g', analyte: ANALYTES[k], status, references: [], missingInputs: [], notes };
}
function reference(kind, type, amount, sources, formula, extra = {}) {
  const ids = Array.isArray(sources) ? sources : [sources];
  for (const id of ids) if (!SOURCES[id]) throw new Error(`Unknown source ${id}`);
  return { kind, referenceType: type, amount: interval(amount, 'reference amount'), sources: ids, formula, ...extra };
}
function add(m, r) { m.references.push(r); m.status = m.missingInputs.length ? 'partial' : 'ok'; return m; }
function missing(m, keys) {
  m.missingInputs = [...new Set([...m.missingInputs, ...keys])];
  m.status = m.references.length ? 'partial' : 'requires_input';
  return m;
}
function required(m, profile, keys) {
  const absent = keys.filter(k => k.split('.').reduce((v, p) => v?.[p], profile) === undefined);
  if (absent.length) { missing(m, absent.map(k => `profile.${k}`)); return false; }
  return true;
}
export function validateProfile(p) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) throw new TypeError('profile must be an object');
  if (p.ageYears !== undefined && (!Number.isInteger(p.ageYears) || p.ageYears < 0))
    throw new RangeError('ageYears must be completed integer years >= 0');
  if (p.sex !== undefined && !['male', 'female'].includes(p.sex)) throw new RangeError('sex must be male or female for these published equations');
  for (const k of ['weightKg', 'heightCm', 'referenceWeightKg', 'fatMassKg']) if (p[k] !== undefined) positive(p[k], k);
  if (p.fatMassKg !== undefined && p.weightKg !== undefined && p.fatMassKg >= p.weightKg)
    throw new RangeError('fatMassKg must be below weightKg');
  for (const k of ['pregnant', 'lactating', 'requiresTherapeuticDiet'])
    if (p[k] !== undefined && typeof p[k] !== 'boolean') throw new TypeError(`${k} must be boolean`);
  if (p.activity?.pal !== undefined) positive(p.activity.pal, 'activity.pal');
  if (p.activity?.cnClass !== undefined && !['light', 'moderate', 'heavy'].includes(p.activity.cnClass))
    throw new RangeError('activity.cnClass must be light, moderate or heavy');
  if (p.training?.weeklyHours !== undefined) finite(p.training.weeklyHours, 'training.weeklyHours', 0);
  if (p.training?.carbohydrateLoad !== undefined && !['low', 'moderate', 'high', 'very_high'].includes(p.training.carbohydrateLoad))
    throw new RangeError('Unknown training.carbohydrateLoad');
  return p;
}
const excluded = p => (p.ageYears !== undefined && p.ageYears < 18) || p.pregnant === true ||
  p.lactating === true || p.requiresTherapeuticDiet === true;
function referenceWeight(p, m) {
  if (p.referenceWeightKg !== undefined) return p.referenceWeightKg;
  if (!required(m, p, ['weightKg', 'heightCm'])) return undefined;
  const bmi = p.weightKg / (p.heightCm / 100) ** 2;
  if (bmi < 18.5 || bmi >= 25) { missing(m, ['profile.referenceWeightKg']);
    m.notes.push('An explicitly selected normal reference weight is needed outside BMI [18.5, 25).'); return undefined; }
  return p.weightKg;
}
function energyReference(m, values, type, source, formula, extra = {}) {
  const x = interval(values, 'energy', true);
  return add(m, reference(x.low === x.high ? 'reference' : 'reference_range', type, x, source, formula, extra));
}
function energyAmount(m) { return m.status === 'ok' && m.references[0] ? m.references[0].amount : null; }

/** A separate energy engine: native tables and explicitly selected individual equations. */
export function calculateEnergy(input) {
  const p = validateProfile(input.profile), m = metric('kcal');
  const method = input.method;
  if (excluded(p)) { m.status = 'out_of_scope'; return m; }
  if (method === 'provided') {
    if (input.kcal === undefined) return missing(m, ['energy.kcal']);
    if (typeof input.label !== 'string' || !input.label.trim()) return missing(m, ['energy.label']);
    return energyReference(m, input.kcal, 'provided_energy', [], 'Explicitly provided energy; no hidden estimation', { label: input.label });
  }
  if (!required(m, p, ['ageYears', 'sex'])) return m;
  const a = p.ageYears, male = p.sex === 'male';
  if (method === 'efsa_table') {
    m.sources = ['efsa_energy', 'efsa_asset'];
    if (a >= 80) { m.notes.push('The published DRV Finder energy table gives no numeric value for age >= 80.'); return m; }
    if (!required(m, p, ['activity.pal'])) return m;
    const row = EFSA_ENERGY.find(r => r.sex === p.sex && a >= r.minAge && a < r.maxAge && r.pal === p.activity.pal);
    if (!row) throw new RangeError('EFSA table PAL must be exactly 1.4, 1.6, 1.8 or 2.0; no interpolation');
    return energyReference(m, row.kcal, 'population_AR', ['efsa_energy', 'efsa_asset'], 'Published kcal column by age, sex and PAL',
      { populationReference: true, ageBand: [row.minAge, row.maxAge], pal: row.pal, publishedMJ: row.publishedMJ });
  }
  if (method === 'ch_table') {
    const values = a < 66 ? (male ? [2305, 2672] : [1861, 2147]) : (male ? [2100, 2800] : [1700, 2100]);
    return energyReference(m, { low: values[0], high: values[1] }, 'population_reference_range', 'ch_table',
      a < 66 ? 'BLV 18–65 years, published group interval at PAL 1.6' : 'BLV >=66 years, published group interval at PAL 1.4–1.8',
      { populationReference: true, notes: ['Actual weight, height and PAL do not individualize this published group interval.'] });
  }
  if (method === 'cn_table') {
    m.sources = ['cn_tables', 'cn_tables2'];
    const row = CN_2023.find(r => a >= r.minAge && (r.maxAge === null || a < r.maxAge));
    const cls = p.activity?.cnClass, pal = p.activity?.pal;
    if (cls === undefined && pal === undefined) return missing(m, ['profile.activity.cnClass or profile.activity.pal']);
    const i = cls === undefined ? row.pal.indexOf(pal) : ['light', 'moderate', 'heavy'].indexOf(cls);
    if (i < 0) throw new RangeError('PAL is not a published value for this Chinese age band');
    if (i >= row.pal.length) { m.notes.push('High-activity EER is not published for this age band.'); return m; }
    if (pal !== undefined && pal !== row.pal[i]) throw new RangeError('cnClass conflicts with the PAL published for this age band');
    const mj = (male ? row.maleMJ : row.femaleMJ)[i];
    return energyReference(m, mj * 1000 / 4.184, 'population_EER', ['cn_tables', 'cn_tables2'], 'Published MJ × 1000 / 4.184',
      { populationReference: true, publishedMJ: mj, pal: row.pal[i], table: row.tables[male ? 0 : 1] });
  }
  if (method === 'dge_ree' && a === 18) {
    if (!required(m, p, ['activity.pal'])) return m;
    const i = [1.4, 1.6, 1.8].indexOf(p.activity.pal);
    if (i < 0) throw new RangeError('Age 18 uses the DGE 15–<19 table, PAL exactly 1.4/1.6/1.8');
    return energyReference(m, (male ? [2600, 3000, 3400] : [2000, 2300, 2600])[i], 'population_guideline',
      'dge_energy_table', 'DGE 15–<19 table; not the >=19 REE equation', { populationReference: true });
  }
  if (!['dge_ree', 'nasem2023', 'mifflin1990', 'henry2005'].includes(method)) throw new RangeError(`Unknown energy method: ${method}`);
  if (!required(m, p, ['weightKg', 'activity.pal'])) return m;
  const w = p.weightKg, pal = p.activity.pal;
  if (method === 'nasem2023') {
    if (!required(m, p, ['heightCm'])) return m;
    const bounds = a === 18 ? [1, 1.56, 1.73, 1.92, 2.5] : [1, 1.53, 1.68, 1.85, 2.5];
    const i = bounds.findIndex((b, j) => j < 4 && pal >= b && pal < bounds[j + 1]);
    if (i < 0) throw new RangeError('NASEM PAL is outside the tabulated [1, 2.5) domain');
    const c = (a === 18 ? NASEM_18 : NASEM_2023)[p.sex][PA[i]];
    const e = c[0] + c[1] * a + c[2] * p.heightCm + c[3] * w;
    return energyReference(m, e, 'individual_EER', 'nasem_energy', 'c0 + cAge*A + cHeight*Hcm + cWeight*W; NO further PAL multiplier',
      { coefficients: [...c], activityCategory: PA[i], includesGrowthKcal: a === 18 ? 20 : 0 });
  }
  if (method === 'dge_ree') {
    const ree = (0.047 * w - 0.01452 * a + 3.21 + (male ? 1.009 : 0)) * 239;
    return energyReference(m, ree * pal, 'individual_estimate', 'dge_energy',
      '(0.047*W - 0.01452*A + 3.21 + (male?1.009:0))*239*PAL', { restingKcal: ree });
  }
  if (!required(m, p, ['heightCm'])) return m;
  if (method === 'mifflin1990') {
    if (a < 19 || a > 78) { m.status = 'out_of_scope'; m.notes.push('Original validation sample: ages 19–78.'); return m; }
    const ree = 9.99 * w + 6.25 * p.heightCm - 4.92 * a + (male ? 166 : 0) - 161;
    return energyReference(m, ree * pal, 'individual_estimate', 'mifflin',
      '(9.99*W + 6.25*Hcm - 4.92*A + 166*S - 161)*PAL; PAL is an explicit planning input', { restingKcal: ree });
  }
  const c = HENRY_WEIGHT_HEIGHT_MJ[p.sex][a < 30 ? 0 : a <= 60 ? 1 : 2];
  const ree = (c[0] * w + c[1] * p.heightCm / 100 + c[2]) * 1000 / 4.184;
  return energyReference(m, ree * pal, 'individual_estimate', 'henry',
    '(a*W + b*Hmetres + c)*1000/4.184*PAL; independently selected Henry method', { restingKcal: ree, coefficients: [...c] });
}

function percentage(m, energy, lo, hi, kcalPerGram, type, source, extra = {}) {
  const e = energyAmount(energy);
  if (!e) { missing(m, ['resolved daily energy']); return; }
  const kind = lo === null ? 'maximum' : hi === null ? 'minimum' : lo === hi ? 'reference' : 'intake_range';
  const amount = { low: e.low * (lo ?? hi) / kcalPerGram, high: e.high * (hi ?? lo) / kcalPerGram };
  add(m, reference(kind, type, amount, source, 'E × energy fraction / kcalPerGram', {
    energyFraction: { low: lo, high: hi }, kcalPerGram, energyKcal: { ...e },
    uncertainEnergy: e.low !== e.high, ...extra
  }));
}
function proteinPerKg(m, p, lo, hi, type, source, useReferenceWeight) {
  const w = useReferenceWeight ? referenceWeight(p, m) : required(m, p, ['weightKg']) ? p.weightKg : undefined;
  if (w === undefined) return;
  add(m, reference(lo === hi ? 'reference' : type === 'PRI' ? 'reference_range' : 'intake_range', type,
    { low: lo * w, high: hi * w }, source, 'g/kg/day × selected weight',
    { gramsPerKg: { low: lo, high: hi }, weightKg: w, weightBasis: useReferenceWeight ? 'normal_reference' : 'actual' }));
}
function sodium(m, mg, kind, type, source, extra = {}) {
  const x = interval(mg, 'sodium');
  add(m, reference(kind, type, multiply(x, 2.5 / 1000), [source, 'salt_conversion'],
    'Sodium mg × 2.5 / 1000 = label salt equivalent g', { sodiumMg: x, ...extra }));
}
function sugar(m, analyte, ref) {
  m.status = 'not_comparable'; m.notes.push(`Current meal data are total_sugars; this standard concerns ${analyte}.`);
  if (ref) { ref.analyte = analyte; m.references.push(ref); }
}
function sugarPercent(m, energy, analyte, fraction, source, strict = true, extra = {}) {
  const temp = metric('sugar'); percentage(temp, energy, null, fraction, 4, 'sugar_guidance', source, { upperInclusive: !strict, ...extra });
  sugar(m, analyte, temp.references[0]);
  if (temp.missingInputs.length) { m.missingInputs = temp.missingInputs; m.notes.push('A numerical related-analyte budget also needs resolved energy.'); }
}
function qualitative(m, note, source) { m.status = 'qualitative'; m.notes.push(note); m.sources = [source]; }

function clinicalEnergy(standard, p, maintenance, plan) {
  const m = metric('kcal');
  if (!plan) return missing(m, ['clinicalPlan']);
  const source = standard === 'nice_ng246' ? 'nice' : standard === 'dag_s3_2024' ? 'dag' : 'cn_obesity';
  let values, formula;
  const e = energyAmount(maintenance);
  const needMaintenance = () => { if (!e) { missing(m, ['energy (maintenance)']); return false; } return true; };
  const subtract = d => ({ low: e.low - d.high, high: e.high - d.low });
  if (standard === 'nice_ng246' || standard === 'dag_s3_2024') {
    if (!needMaintenance()) return m;
    if (plan.kind === 'deficit_kcal') {
      const d = interval(plan.amount, 'clinicalPlan.amount', true);
      values = subtract(d); formula = 'Maintenance E − explicitly chosen daily deficit';
    } else if (standard === 'dag_s3_2024' && plan.kind === 'guideline_deficit') {
      values = subtract({ low: 500, high: 600 }); formula = 'Maintenance E − [600, 500] kcal (S3 5.11)';
    } else throw new RangeError('NICE requires deficit_kcal; S3 also supports guideline_deficit');
  } else if (plan.kind === 'sex_band') {
    if (!required(m, p, ['sex'])) return m;
    values = p.sex === 'male' ? { low: 1200, high: 1500 } : { low: 1000, high: 1200 };
    formula = 'Published sex-specific restricted-energy interval';
  } else if (plan.kind === 'ideal_weight') {
    if (!required(m, p, ['heightCm'])) return m;
    const factor = interval(plan.kcalPerIdealKg, 'clinicalPlan.kcalPerIdealKg', true);
    const options = { bed_rest: [15, 15], light: [20, 25], moderate: [30, 30], heavy: [35, 35] };
    const allowed = options[plan.activity];
    if (!allowed || factor.low < allowed[0] || factor.high > allowed[1]) throw new RangeError('Factor must be inside the published activity-specific interval');
    const ideal = p.heightCm - 105; positive(ideal, 'heightCm − 105');
    values = multiply(factor, ideal); formula = '(Height cm − 105) × explicitly selected activity kcal/kg';
    m.notes.push('This ideal-weight formula belongs specifically to the NHC obesity guidance.');
  } else {
    if (!needMaintenance()) return m;
    if (plan.kind === 'guideline_deficit') {
      values = subtract({ low: 500, high: 1000 }); formula = 'Maintenance E − [1000, 500] kcal';
    } else if (plan.kind === 'guideline_fraction') {
      values = { low: 0.5 * e.low, high: 0.7 * e.high }; formula = 'Maintenance E × [0.50, 0.70] (30–50% reduction)';
    } else if (plan.kind === 'bmi_reduction') {
      if (!required(m, p, ['weightKg', 'heightCm'])) return m;
      const bmi = p.weightKg / (p.heightCm / 100) ** 2;
      if (bmi < 24) { m.status = 'out_of_scope'; m.notes.push('This branch requires Chinese BMI >=24.'); return m; }
      values = multiply(e, bmi < 28 ? 0.85 : 0.8); formula = 'Overweight: actual maintenance ×0.85; obesity: ×0.80';
      if (plan.restingKcal === undefined) return missing(m, ['clinicalPlan.restingKcal (BMR lower-bound condition)']);
      positive(plan.restingKcal, 'clinicalPlan.restingKcal');
      if (values.low <= plan.restingKcal) throw new RangeError('NHC BMI branch requires planned intake above BMR; no silent clamping');
    } else throw new RangeError('Unknown NHC obesity energy method');
  }
  energyReference(m, values, 'clinical_energy_plan', source, formula,
    { maintenanceEnergyKcal: e, clinicalMethod: plan.kind });
  if (standard === 'nice_ng246' && m.references[0].amount.low <= 1200)
    m.notes.push('NICE 800–1200 kcal plans require specialist support; <800 requires a selected specialist programme.');
  m.notes.push('A clinical guideline calculation is not individual medical clearance or a diagnosis.');
  return m;
}

function resolveAllocation(input) {
  if (!input) return null;
  let a;
  if (input.kind === 'dge_quarters') a = { lunch: 0.25, dinner: 0.25, source: 'dge_meals', provenance: 'DGE Job&Fit quarter planning model' };
  else if (input.kind === 'cn_obesity_343') a = { lunch: 0.4, dinner: 0.3, source: 'cn_obesity', provenance: 'NHC obesity 3:4:3 energy allocation; other nutrients are a proportional planning projection' };
  else if (input.kind === 'explicit') a = { lunch: input.lunch, dinner: input.dinner, provenance: 'User/developer explicitly supplied planning allocation' };
  else throw new RangeError('allocation.kind must be explicit, dge_quarters or cn_obesity_343');
  finite(a.lunch, 'allocation.lunch', 0, 1); finite(a.dinner, 'allocation.dinner', 0, 1);
  if (a.lunch + a.dinner > 1 + 1e-12) throw new RangeError('Lunch + dinner shares cannot exceed 1');
  a.unallocated = Math.max(0, 1 - a.lunch - a.dinner);
  return a;
}
function project(day, meal, allocation) {
  const out = {};
  for (const k of NUTRIENTS) {
    const m = clone(day[k]);
    const direct = m.references.filter(r => r.period === 'meal');
    if (!allocation && m.references.some(r => r.period !== 'meal')) {
      m.references = direct;
      missing(m, ['allocation']);
      if (day[k].status === 'not_comparable') m.status = 'not_comparable';
    } else {
      m.references = m.references.map(r => {
        if (r.period === 'meal') return { ...r, meal, projection: 'native_per_meal' };
        const share = allocation[meal];
        const z = { ...r, amount: multiply(r.amount, share), period: 'meal', meal, share,
          projection: 'daily_reference_planning_allocation', dailyAmount: { ...r.amount } };
        // Keep related quantities in the same meal period; fractions and energy dependency stay daily metadata.
        if (r.sodiumMg) z.sodiumMg = multiply(r.sodiumMg, share);
        return z;
      });
    }
    out[k] = m;
  }
  return out;
}

/** Pure calculation. No DOM, network, persistence, rounding, or implicit meal shares. */
export function calculateTargets(request) {
  if (!request || !own(STANDARDS, request.standard)) throw new RangeError('Unknown standard');
  if (request.whoSugarLevel !== undefined && !['standard_10_percent', 'conditional_5_percent'].includes(request.whoSugarLevel))
    throw new RangeError('Unknown whoSugarLevel');
  if (request.proteinMealStrategy !== undefined && (request.standard !== 'issn' ||
      !['proportional', 'issn_weight_dose', 'issn_absolute_dose'].includes(request.proteinMealStrategy)))
    throw new RangeError('proteinMealStrategy is an ISSN-only selection');
  if (request.s3MacroPolicy !== undefined && (request.standard !== 'dag_s3_2024' ||
      !['individualized', 'dge_general', 'dge_physically_active'].includes(request.s3MacroPolicy)))
    throw new RangeError('Unknown S3 macronutrient policy');
  const s = request.standard, p = validateProfile(request.profile), allocation = resolveAllocation(request.allocation);
  const day = Object.fromEntries(NUTRIENTS.map(k => [k, metric(k)]));
  const notes = ['Daily references projected onto meals are planning quantities, not diagnostic thresholds or per-meal safety limits.'];
  if (excluded(p)) {
    for (const m of Object.values(day)) m.status = 'out_of_scope';
  } else if (p.ageYears === undefined) {
    for (const m of Object.values(day)) missing(m, ['profile.ageYears']);
  } else if (s === 'cn_obesity_2024' && (p.weightKg === undefined || p.heightCm === undefined)) {
    const absent = ['weightKg', 'heightCm'].filter(k => p[k] === undefined).map(k => `profile.${k}`);
    for (const m of Object.values(day)) missing(m, absent);
    notes.push('Weight and height are required to check the scope of the Chinese overweight/obesity guidance.');
  } else if (s === 'cn_obesity_2024' && p.weightKg / (p.heightCm / 100) ** 2 < 24) {
    for (const m of Object.values(day)) m.status = 'out_of_scope';
    notes.push('The Chinese overweight/obesity guidance requires BMI >=24; it is not a normal-weight dieting prescription.');
  } else {
    const native = { efsa: 'efsa_table', dge_oege: 'dge_ree', ch_blv: 'ch_table', cn_dri_2023: 'cn_table', us_nasem: 'nasem2023' };
    const ei = request.energy ?? (native[s] ? { method: native[s] } : null);
    const maintenance = ei ? calculateEnergy({ ...ei, profile: p }) : missing(metric('kcal'), ['energy (explicit method or provided maintenance energy)']);
    day.kcal = ['nice_ng246', 'dag_s3_2024', 'cn_obesity_2024'].includes(s)
      ? clinicalEnergy(s, p, maintenance, request.clinicalPlan) : maintenance;
    if (!native[s] && !ei && !['nice_ng246', 'dag_s3_2024', 'cn_obesity_2024'].includes(s))
      day.kcal.notes.push('This guideline does not itself specify an individual energy equation.');
    const e = day.kcal, a = p.ageYears, male = p.sex === 'male';
    const fixed = (key, kind, type, value, source, extra = {}) => add(day[key], reference(kind, type, value, source, 'Published fixed daily reference', extra));
    const pct = (key, lo, hi, factor, type, source, extra) => percentage(day[key], e, lo, hi, factor, type, source, extra);
    const pkg = (lo, hi, type, source, refWeight = true) => proteinPerKg(day.protein, p, lo, hi, type, source, refWeight);
    if (s === 'efsa') {
      pkg(.83, .83, 'PRI', 'efsa_protein'); pct('carbs', .45, .60, 4, 'RI', 'efsa_carbs');
      pct('fat', .20, .35, 9, 'RI', 'efsa_fat'); fixed('fiber', 'reference', 'AI', 25, 'efsa_carbs');
      qualitative(day.saturated, 'As low as possible within a nutritionally adequate diet; no numeric upper limit established.', 'efsa_fat');
      sugar(day.sugar, 'free_or_added_sugars'); day.sugar.notes.push('As low as possible; EFSA did not establish a numerical UL.'); day.sugar.sources = ['efsa_sugars'];
      sodium(day.salt, 2000, 'reference', 'safe_and_adequate', 'efsa_sodium');
    } else if (s === 'dge_oege') {
      if (a === 18 && !required(day.protein, p, ['sex'])) { /* only this age uses sex-specific protein factors */ }
      else { const f = a === 18 && male ? .9 : a >= 65 ? 1 : .8; pkg(f, f, a >= 65 ? 'estimated_adequate_intake' : 'recommended_intake', 'dge_protein'); }
      pct('carbs', .50, null, 4, 'guideline', 'dge_carbs', { lowerInclusive: false });
      pct('fat', .30, .30, 9, 'guideline_reference', 'dge_fat');
      if (p.activity?.pal > 1.7) day.fat.notes.push('High activity can justify higher fat intake; 30 E% is not a strict upper limit.');
      pct('saturated', null, .10, 9, 'guideline_limit', 'dge_sfa');
      sugarPercent(day.sugar, e, 'free_sugars', .10, 'dge_sugars');
      if (a >= 19) fixed('fiber', 'minimum', 'guideline', 30, 'dge_fibre');
      else { day.fiber.sources = ['dge_fibre']; day.fiber.notes.push('No formal daily fibre guideline for <19; 14.6 g/1000 kcal is an explanatory planning density, not a derived 30 g requirement.'); }
      sodium(day.salt, 1500, 'reference', 'AI_estimate', 'dge_sodium');
      fixed('salt', 'maximum', 'public_health_guidance', 6, 'dge_salt');
    } else if (s === 'ch_blv') {
      pkg(a < 66 ? .83 : 1, a < 66 ? .83 : 1.2, 'PRI', 'ch_table');
      pct('carbs', .45, a < 66 ? .60 : .65, 4, 'RI', 'ch_table'); pct('fat', .20, .35, 9, 'RI', 'ch_table');
      pct('saturated', null, .10, 9, 'guideline_limit', 'ch_table', { upperInclusive: false });
      sugarPercent(day.sugar, e, 'free_sugars', .10, ['ch_table', 'ch_sugar_definition'], false);
      fixed('fiber', a < 66 ? 'minimum' : 'reference_range', 'AI', a < 66 ? 30 : { low: 25, high: 30 }, 'ch_table');
      sodium(day.salt, a < 66 ? 2000 : { low: 1200, high: 1500 }, a < 66 ? 'reference' : 'reference_range', 'AI', 'ch_table');
      fixed('salt', 'maximum', 'public_health_guidance', 5, 'ch_salt');
    } else if (s === 'cn_dri_2023') {
      const r = CN_2023.find(r => a >= r.minAge && (r.maxAge === null || a < r.maxAge));
      if (required(day.protein, p, ['sex'])) fixed('protein', 'reference', 'RNI', r.protein[male ? 0 : 1], 'cn_tables');
      pct('protein', ...r.proteinFraction, 4, 'AMDR', 'cn_tables');
      pct('carbs', .50, .65, 4, 'AMDR', 'cn_tables'); pct('fat', .20, .30, 9, 'AMDR', 'cn_tables');
      pct('saturated', null, .10, 9, 'guideline_limit', 'cn_tables', { upperInclusive: false });
      sugarPercent(day.sugar, e, 'added_sugars', .10, 'cn_tables');
      fixed('fiber', 'reference_range', 'AI', { low: 25, high: 30 }, 'cn_tables');
      sodium(day.salt, r.sodiumAI, 'reference', 'AI', 'cn_tables');
      sodium(day.salt, r.sodiumPI, 'maximum', 'PI', 'cn_tables', { upperInclusive: true });
    } else if (s === 'us_nasem') {
      pkg(a === 18 ? .85 : .8, a === 18 ? .85 : .8, 'RDA', 'nasem_macros');
      pct('protein', .10, a === 18 ? .30 : .35, 4, 'AMDR', 'nasem_macros');
      pct('carbs', .45, .65, 4, 'AMDR', 'nasem_macros'); fixed('carbs', 'reference', 'RDA', 130, 'nasem_macros');
      pct('fat', a === 18 ? .25 : .20, .35, 9, 'AMDR', 'nasem_macros');
      if (required(day.fiber, p, ['sex'])) fixed('fiber', 'reference', 'AI', male ? (a <= 50 ? 38 : 30) : (a === 18 ? 26 : a <= 50 ? 25 : 21), 'nasem_macros');
      qualitative(day.saturated, 'As low as possible while consuming a nutritionally adequate diet; no numerical UL.', 'nasem_macros');
      sugarPercent(day.sugar, e, 'added_sugars', .25, 'nasem_macros', false, { referenceType: '2005_nutrient_displacement_guidance' });
      day.sugar.notes.push('The 25 E% statement is historical nutrient-displacement advice, not a UL or the current DGA meal recommendation.');
      sodium(day.salt, 1500, 'reference', 'AI', 'nasem_sodium'); sodium(day.salt, 2300, 'reduction_threshold', 'CDRR', 'nasem_sodium');
    } else if (s === 'us_dga_2025') {
      pkg(1.2, 1.6, 'protein_goal', 'dga', false); pct('saturated', null, .10, 9, 'guideline_limit', 'dga');
      sodium(day.salt, 2300, 'maximum', 'guideline_limit', 'dga', { upperInclusive: false });
      sugar(day.sugar, 'added_sugars', reference('maximum', 'per_meal_guidance', 10, 'dga', 'No more than 10 g added sugars in one meal', { period: 'meal', upperInclusive: true }));
    } else if (s === 'who') {
      pct('fat', null, .30, 9, 'guideline_limit', 'who_fat'); pct('saturated', null, .10, 9, 'guideline_limit', 'who_fat');
      sugarPercent(day.sugar, e, 'free_sugars', request.whoSugarLevel === 'conditional_5_percent' ? .05 : .10, 'who_sugars', true);
      fixed('fiber', 'minimum', 'guideline', 25, 'who_fat');
      sodium(day.salt, 2000, 'maximum', 'guideline_limit', 'who_sodium', { upperInclusive: false });
      qualitative(day.carbs, 'WHO specifies carbohydrate quality and fibre, not an adult carbohydrate quantity target here.', 'who_fat');
    } else if (s === 'dge_sport') {
      if (required(day.protein, p, ['training.weeklyHours'])) {
        if (p.training.weeklyHours > 5) pkg(1.2, 2, 'athlete_guidance', 'dge_sport', false);
        else { day.protein.status = 'out_of_scope'; day.protein.notes.push('<=5 h/week does not trigger the DGE athlete protein range; select the age-appropriate general DGE reference.'); }
      }
    } else if (s === 'issn') {
      pkg(1.4, 2, 'athlete_guidance', 'issn', false);
    } else if (s === 'acsm') {
      pkg(1.2, 2, 'athlete_guidance', 'acsm', false); pct('fat', .20, .35, 9, 'athlete_guidance', 'nih_sport');
      if (required(day.carbs, p, ['weightKg', 'training.carbohydrateLoad'])) {
        const r = { low: [3, 5], moderate: [5, 7], high: [6, 10], very_high: [8, 12] }[p.training.carbohydrateLoad];
        add(day.carbs, reference('intake_range', 'training_load_guidance', { low: r[0] * p.weightKg, high: r[1] * p.weightKg },
          ['acsm', 'dge_sport_carbs'], 'Training-load g/kg/day × actual body weight', { weightKg: p.weightKg, gramsPerKg: { low: r[0], high: r[1] } }));
      }
    } else if (s === 'dag_s3_2024') {
      // Prevention recommendations remain labelled separately from the energy treatment plan.
      sugarPercent(day.sugar, e, 'free_sugars', .10, 'dag');
      day.sugar.notes.push('S3 prevention recommendation 4.9; projected with the explicitly selected planned energy.');
      qualitative(day.fiber, 'S3 4.8: favour a high-fibre diet; no unconditional gram target is set here.', 'dag');
      const policy = request.s3MacroPolicy ?? 'individualized';
      if (policy === 'individualized') {
        for (const key of ['protein', 'fat', 'carbs'])
          qualitative(day[key], 'S3 4.10 allows individual macro strategies; explicitly choose a DGE orientation to obtain those quantities.', 'dag');
      } else {
        const f = a <= 65 ? .8 : 1;
        pkg(f, f, 'S3_2024_DGE_orientation', 'dag');
        pct('fat', null, policy === 'dge_physically_active' ? .35 : .30, 9, 'S3_2024_DGE_orientation', 'dag');
        pct('carbs', .50, null, 4, 'S3_2024_DGE_orientation', 'dag', { lowerInclusive: false });
        notes.push('Explicit S3 4.10 DGE orientation uses the 2024 document wording, including protein <=65/>65; it is not a forced universal weight-loss macro prescription.');
      }
    } else if (s === 'cn_obesity_2024') {
      pct('protein', .15, .20, 4, 'clinical_macronutrient_guidance', 'cn_obesity');
      pct('carbs', .50, .60, 4, 'clinical_macronutrient_guidance', 'cn_obesity');
      pct('fat', .20, .30, 9, 'clinical_macronutrient_guidance', 'cn_obesity');
      fixed('salt', 'maximum', 'guideline_limit', 5, 'cn_obesity');
      sugar(day.sugar, 'added_sugars', reference('maximum', 'preferred_guidance', 25, 'cn_obesity', 'Preferably <25 g/day added sugars', { upperInclusive: false }));
      qualitative(day.fiber, 'Increase fibre-rich foods; this guideline does not set a standalone fibre gram target.', 'cn_obesity');
    }
  }
  // All daily references explicitly carry their original period. DGA's meal cap remains per-meal.
  for (const m of Object.values(day)) for (const r of m.references) r.period ??= 'day';
  const lunch = project(day, 'lunch', allocation), dinner = project(day, 'dinner', allocation);
  if (s === 'issn' && request.proteinMealStrategy && request.proteinMealStrategy !== 'proportional') {
    for (const [meal, target] of [['lunch', lunch], ['dinner', dinner]]) {
      if (target.protein.status === 'out_of_scope' || p.ageYears === undefined) continue;
      const m = metric('protein');
      if (request.proteinMealStrategy === 'issn_weight_dose') {
        if (required(m, p, ['weightKg'])) add(m, reference('meal_dose', 'ISSN_weight_based_dose', .25 * p.weightKg, 'issn', '.25 g/kg per dose', { weightKg: p.weightKg }));
      } else if (request.proteinMealStrategy === 'issn_absolute_dose') {
        add(m, reference('meal_dose', 'ISSN_absolute_dose', { low: 20, high: 40 }, 'issn', 'Alternative absolute high-quality protein dose; not an absorption ceiling'));
      } else throw new RangeError('Unknown proteinMealStrategy');
      for (const r of m.references) { r.period = 'meal'; r.meal = meal; r.projection = 'native_per_meal'; }
      target.protein = m;
    }
  }
  return { version: VERSION, standard: s, standardName: STANDARDS[s], snapshotDate: '2026-10-16',
    allocation, daily: day, lunch, dinner, notes };
}
