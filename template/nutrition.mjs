// Pure boundary between the supplied calculation core, persisted preferences and UI.
// The build packages the original core modules without modifying their formulas.
import {calculateTargets, STANDARDS} from '../zmittag-nutrition-core/core.mjs';
export {STANDARDS};

export const DEFAULT_NUTRITION = Object.freeze({standard: 'ch_blv', energyMethod: 'standard',
  lunchPercent: 40, dinnerPercent: 30, proteinMealStrategy: 'proportional', s3MacroPolicy: 'individualized'});
// Fields carry catalog keys only; their text lives in template/i18n/<code>.json.
const numberField = (key, min, max, step = 'any', {unit, hint = false} = {}) => ({key, min, max, step, type: 'number',
  labelKey: `field.${key}.label`, hintKey: hint ? `field.${key}.hint` : '', unitKey: unit ? `unit.${unit}` : ''});
const choiceField = (key, values, optionKey = value => `option.${key}.${value}`) => ({key, type: 'select',
  labelKey: `field.${key}.label`, hintKey: '', unitKey: '',
  options: values.map(value => [value, value === '' ? 'option.choose' : optionKey(value)])});
export const PROFILE_FIELDS = [
  numberField('ageYears', 0, 120, 1, {unit: 'years'}),
  choiceField('sex', ['', 'female', 'male']),
  numberField('heightCm', 50, 250, 'any', {unit: 'cm'}),
  numberField('weightKg', 10, 500, 'any', {unit: 'kg'}),
  choiceField('activity.pal', ['', '1.4', '1.6', '1.8', '2']),
  choiceField('activity.cnClass', ['', 'light', 'moderate', 'heavy']),
  numberField('referenceWeightKg', 10, 500, 'any', {unit: 'kg', hint: true}),
  numberField('training.weeklyHours', 0, 168, 'any', {unit: 'hoursPerWeek'}),
  choiceField('training.carbohydrateLoad', ['', 'low', 'moderate', 'high', 'very_high']),
  choiceField('scope', ['general', 'pregnant', 'lactating', 'requiresTherapeuticDiet']),
];
export const PLAN_FIELDS = [
  numberField('lunchPercent', 0, 100, 'any', {unit: 'percent'}),
  numberField('dinnerPercent', 0, 100, 'any', {unit: 'percent'}),
  numberField('energyKcal', 1, 20000, 'any', {unit: 'kcal', hint: true}),
  numberField('deficitKcal', 1, 5000, 'any', {unit: 'kcalPerDay', hint: true}),
];
export const SETTING_FIELDS = [
  choiceField('standard', Object.keys(STANDARDS), id => `standard.${id}`),
  choiceField('energyMethod', ['standard', 'mifflin1990', 'henry2005', 'provided']),
  choiceField('proteinMealStrategy', ['proportional', 'issn_weight_dose', 'issn_absolute_dose']),
  choiceField('s3MacroPolicy', ['individualized', 'dge_general', 'dge_physically_active']),
];
// Plain explanation shown under the standard menu, above Energy calculation.
// The lead is the standard name’s first word; the UI places the source links beside it.
const NOTE_LINKS = {
  efsa: ['https://en.wikipedia.org/wiki/European_Food_Safety_Authority', 'https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values'],
  dge_oege: ['https://de.wikipedia.org/wiki/Deutsche_Gesellschaft_für_Ernährung', 'https://www.dge.de/wissenschaft/referenzwerte/'],
  ch_blv: ['https://de.wikipedia.org/wiki/Bundesamt_für_Lebensmittelsicherheit_und_Veterinärwesen', 'https://www.blv.admin.ch/de/naehrstoffzufuhr'],
  cn_dri_2023: ['https://zh.wikipedia.org/wiki/中国营养学会', 'https://www.cnsoc.org/drpostand/'],
  us_nasem: ['https://en.wikipedia.org/wiki/National_Academies_of_Sciences,_Engineering,_and_Medicine', 'https://www.nationalacademies.org/projects/HMD-FNB-21-04/publication/26818'],
  us_dga_2025: ['https://en.wikipedia.org/wiki/Dietary_Guidelines_for_Americans', 'https://www.dietaryguidelines.gov/'],
  who: ['https://en.wikipedia.org/wiki/World_Health_Organization', 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet'],
  dge_sport: ['https://de.wikipedia.org/wiki/Deutsche_Gesellschaft_für_Ernährung', 'https://www.dge.de/presse/meldungen/2020/positionspapier-zur-proteinzufuhr-im-sport/'],
  issn: ['https://en.wikipedia.org/wiki/Sports_nutrition', 'https://www.sportsnutritionsociety.org/'],
  acsm: ['https://en.wikipedia.org/wiki/Academy_of_Nutrition_and_Dietetics', 'https://pubmed.ncbi.nlm.nih.gov/26920240/'],
  nice_ng246: ['https://en.wikipedia.org/wiki/National_Institute_for_Health_and_Care_Excellence', 'https://www.nice.org.uk/guidance/ng246'],
  dag_s3_2024: ['https://de.wikipedia.org/wiki/Deutsche_Adipositas-Gesellschaft', 'https://register.awmf.org/de/leitlinien/detail/050-001'],
  cn_obesity_2024: ['https://en.wikipedia.org/wiki/National_Health_Commission', 'https://www.cnsoc.org/images/@cmsxh_7108bb5a-13de-4356-a2a9-50d178413c39.pdf'],
};
export const STANDARD_NOTES = Object.fromEntries(Object.entries(NOTE_LINKS).map(([id, [wiki, official]]) =>
  [id, {wiki, official, leadKey: `note.${id}.lead`, bodyKey: `note.${id}.body`}]));
/** Every catalog key built from the definitions above (verified against en.json by the i18n contract). */
export function messageKeys() {
  const keys = [];
  for (const field of [...PROFILE_FIELDS, ...PLAN_FIELDS, ...SETTING_FIELDS]) {
    keys.push(field.labelKey, field.hintKey, field.unitKey, ...(field.options || []).map(([, key]) => key));
  }
  for (const note of Object.values(STANDARD_NOTES)) keys.push(note.leadKey, note.bodyKey);
  return [...new Set(keys.filter(Boolean))];
}
export function readPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
export function writePath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  if (value === undefined) delete target[keys.at(-1)];
  else target[keys.at(-1)] = value;
  for (const key of Object.keys(object)) if (object[key] && typeof object[key] === 'object' && !Object.keys(object[key]).length) delete object[key];
}
/** Validation failure as a catalog key, translated where it is shown. */
export class FieldError extends Error {
  constructor(key, params = {}) {
    super(key);
    this.key = key;
    this.params = params;
  }
}
export function fieldValue(field, raw) {
  if (raw === '') return undefined;
  if (field.type === 'select') {
    if (!field.options.some(([value]) => String(value) === String(raw))) throw new FieldError('error.chooseOption');
    return field.key === 'activity.pal' ? Number(raw) : raw;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value)))
    throw new FieldError(field.step === 1 ? 'error.wholeNumber' : 'error.number', {min: field.min, max: field.max});
  return value;
}
export function sanitizeProfile(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const field of PROFILE_FIELDS.filter(field => field.key !== 'scope')) {
    const raw = readPath(value, field.key);
    if (raw === undefined || raw === null) continue;
    try { writePath(result, field.key, fieldValue(field, raw)); } catch { /* discard invalid persisted fields */ }
  }
  for (const key of ['pregnant', 'lactating', 'requiresTherapeuticDiet']) if (typeof value[key] === 'boolean') result[key] = value[key];
  return result;
}
export function sanitizeNutrition(value) {
  const result = {...DEFAULT_NUTRITION};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const field of [...PLAN_FIELDS, ...SETTING_FIELDS]) {
    if (value[field.key] === undefined || value[field.key] === null) continue;
    try {
      const parsed = fieldValue(field, value[field.key]);
      if (parsed !== undefined) result[field.key] = parsed;
    } catch { /* retain defaults for malformed storage */ }
  }
  if (result.lunchPercent + result.dinnerPercent > 100) {
    result.lunchPercent = DEFAULT_NUTRITION.lunchPercent;
    result.dinnerPercent = DEFAULT_NUTRITION.dinnerPercent;
  }
  return result;
}
export function validNutritionPreferences(p) {
  // Reject unknown keys and malformed values instead of letting a remote payload
  // introduce unvalidated fields. Nested profile fields are checked recursively.
  const canonical = value => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
  return (p.userProfile === undefined || (p.userProfile && JSON.stringify(canonical(p.userProfile)) === JSON.stringify(canonical(sanitizeProfile(p.userProfile))))) &&
    (p.nutritionSettings === undefined || (p.nutritionSettings &&
      JSON.stringify(canonical(p.nutritionSettings)) === JSON.stringify(canonical(sanitizeNutrition(p.nutritionSettings)))));
}
export const isClinical = standard => ['nice_ng246', 'dag_s3_2024', 'cn_obesity_2024'].includes(standard);
export function profileFields(profile, settings, result) {
  const cn = settings.standard === 'cn_dri_2023' && settings.energyMethod === 'standard';
  const needsReference = Object.values(result?.daily || {}).some(metric => metric.missingInputs.includes('profile.referenceWeightKg'));
  return PROFILE_FIELDS.filter(field => {
    if (field.key === 'activity.cnClass') return cn;
    if (field.key === 'activity.pal') return !cn;
    if (field.key === 'referenceWeightKg') return needsReference || profile.referenceWeightKg !== undefined;
    if (field.key === 'training.weeklyHours') return settings.standard === 'dge_sport';
    if (field.key === 'training.carbohydrateLoad') return settings.standard === 'acsm';
    return true;
  });
}
export function planningFields(settings) {
  return PLAN_FIELDS.filter(field => field.key === 'energyKcal' ? settings.energyMethod === 'provided'
    : field.key === 'deficitKcal' ? ['nice_ng246', 'dag_s3_2024'].includes(settings.standard) : true);
}
export function settingFields(settings) {
  return SETTING_FIELDS.filter(field => field.key === 'proteinMealStrategy' ? settings.standard === 'issn'
    : field.key === 's3MacroPolicy' ? settings.standard === 'dag_s3_2024' : true);
}
export function calculatePlan(profile, settings) {
  const p = structuredClone(profile);
  if (settings.standard === 'cn_dri_2023' && settings.energyMethod === 'standard' && p.activity) delete p.activity.pal;
  const request = {standard: settings.standard, profile: p,
    allocation: {kind: 'explicit', lunch: settings.lunchPercent / 100, dinner: settings.dinnerPercent / 100}};
  if (settings.energyMethod !== 'standard') request.energy = settings.energyMethod === 'provided'
    ? {method: 'provided', kcal: settings.energyKcal, label: 'User-provided daily energy'} : {method: settings.energyMethod};
  if (['nice_ng246', 'dag_s3_2024'].includes(settings.standard) && settings.deficitKcal !== undefined)
    request.clinicalPlan = {kind: 'deficit_kcal', amount: settings.deficitKcal};
  // This choice is named in the settings note; it is never silently applied to
  // other standards. The common, editable meal split remains explicit.
  if (settings.standard === 'cn_obesity_2024') request.clinicalPlan = {kind: 'guideline_fraction'};
  if (settings.standard === 'issn') request.proteinMealStrategy = settings.proteinMealStrategy;
  if (settings.standard === 'dag_s3_2024') request.s3MacroPolicy = settings.s3MacroPolicy;
  return calculateTargets(request);
}

const ANALYTES = {kcal: 'energy', protein: 'protein', fat: 'total_fat', saturated: 'saturated_fat',
  carbs: 'available_carbohydrate', sugar: 'total_sugars', salt: 'label_salt_equivalent', fiber: 'dietary_fibre'};
const PRIORITY = ['maximum', 'reduction_threshold', 'intake_range', 'meal_dose', 'minimum', 'reference_range', 'reference'];
const KIND_KEYS = {maximum: 'kind.maximum', reduction_threshold: 'kind.reduction_threshold', intake_range: 'kind.intake_range',
  meal_dose: 'kind.meal_dose', minimum: 'kind.minimum', reference_range: 'kind.reference_range', reference: 'kind.reference'};
const amountText = (x, unit) => `${formatAmount(x.low)}${x.low !== x.high ? '–' + formatAmount(x.high) : ''} ${unit}`;
const numberFormat = new Intl.NumberFormat('en', {maximumFractionDigits: 1});
export function formatAmount(value) { return numberFormat.format(value); }
/** Precompute comparable references once per profile/standard, never per dish. */
export function coverageTargets(metrics) {
  return Object.fromEntries(Object.entries(metrics || {}).flatMap(([key, metric]) => {
    if (!['ok', 'partial'].includes(metric.status) || metric.analyte !== ANALYTES[key]) return [];
    const refs = metric.references.filter(ref => (!ref.analyte || ref.analyte === ANALYTES[key]) &&
      Number.isFinite(ref.amount.low) && Number.isFinite(ref.amount.high) && ref.amount.high > 0);
    const ref = [...refs].sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind))[0];
    if (!ref) return [];
    const limit = ['maximum', 'reduction_threshold'].includes(ref.kind);
    const range = ref.kind === 'intake_range' || (ref.kind === 'meal_dose' && ref.amount.low !== ref.amount.high);
    // Every applicable reference stays in the accessible description, not only the displayed one.
    const references = refs.map(r => ({type: r.referenceType, amount: amountText(r.amount, metric.unit), kind: r.kind, kindKey: KIND_KEYS[r.kind] || ''}));
    const labelKey = limit ? 'coverage.target.budget' : range ? 'coverage.target.range'
      : ref.kind === 'minimum' ? 'coverage.target.minimum' : 'coverage.target.reference';
    return [[key, {ref, limit, range, labelKey, amount: amountText(ref.amount, metric.unit), references}]];
  }));
}
/** Only a finite serving total is comparable. Zero is real data, not missing. */
export function coverage(total, target, key) {
  if (typeof total !== 'number' || !Number.isFinite(total) || total < 0 || !target) return null;
  const {ref, limit, range} = target;
  const {low, high} = ref.amount;
  const tolerance = 1e-10 * Math.max(1, high);
  const below = total < low - tolerance || (ref.lowerInclusive === false && Math.abs(total - low) <= tolerance);
  const above = total > high + tolerance || (ref.upperInclusive === false && Math.abs(total - high) <= tolerance);
  let tone = 'met', statusKey;
  if (limit) {
    tone = above ? 'high' : 'met';
    statusKey = above ? 'coverage.status.aboveBudget'
      : low !== high && total >= low ? 'coverage.status.withinBudgetInterval' : 'coverage.status.withinBudget';
  } else if (below) { tone = 'low'; statusKey = range ? 'coverage.status.belowRange' : 'coverage.status.belowReference'; }
  else if (above && (range || key === 'kcal')) { tone = 'high'; statusKey = range ? 'coverage.status.aboveRange' : 'coverage.status.abovePlan'; }
  else statusKey = range ? 'coverage.status.inRange' : 'coverage.status.referenceCovered';
  return {tone, percent: Math.round(total / high * 100), fill: Math.min(1, total / high), statusKey};
}

/** Rank the caller's selected-day/meal candidates using the SAME references as
 * coverage. Missing serving totals are unknown, never zero or per-100g values.
 * Compare the most complete evidence first, then the mean relative distance to
 * each acceptable range/budget/minimum. Every nutrient has equal weight; units
 * cannot dominate the score. Covered minima and unused upper budgets cost zero.
 * Source order breaks ties so repeated renders never shuffle equal matches. */
export function rankMeals(candidates, targets, limit = 3) {
  const keys = Object.keys(targets || {});
  if (!keys.length) return [];
  return candidates.flatMap((candidate, order) => {
    const totals = candidate.dish.nutrition?.total || {};
    if (!Object.entries(totals).some(([key, value]) => key !== 'weight' && Number.isFinite(value) && value > 0)) return [];
    let compared = 0, met = 0, deviation = 0;
    for (const key of keys) {
      const target = targets[key], total = totals[key];
      const value = coverage(total, target, key);
      if (!value) continue;
      compared++;
      if (value.tone === 'met') { met++; continue; }
      const edge = value.tone === 'low' ? target.ref.amount.low : target.ref.amount.high;
      // An exclusive boundary is a real miss even when the numerical gap is 0.
      deviation += Math.max(1e-10, Math.abs(total - edge) / target.ref.amount.high);
    }
    if (!compared) return [];
    return [{...candidate, compared, met, missing: keys.length - compared,
      deviation: deviation / compared, order}];
  }).sort((a, b) => a.missing - b.missing || a.deviation - b.deviation || a.order - b.order)
    .slice(0, limit);
}
