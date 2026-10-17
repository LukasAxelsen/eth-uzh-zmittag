// Pure boundary between the supplied calculation core, persisted preferences and UI.
// The build packages the original core modules without modifying their formulas.
import {calculateTargets, STANDARDS} from '../zmittag-nutrition-core/core.mjs';
export {STANDARDS};

export const DEFAULT_NUTRITION = Object.freeze({standard: 'ch_blv', energyMethod: 'standard',
  lunchPercent: 40, dinnerPercent: 30, proteinMealStrategy: 'proportional', s3MacroPolicy: 'individualized'});
const numberField = (key, label, min, max, step = 'any', hint = '', unit = '') => ({key, label, min, max, step, hint, unit, type: 'number'});
const choiceField = (key, label, options, hint = '') => ({key, label, options, hint, type: 'select'});
export const PROFILE_FIELDS = [
  numberField('ageYears', 'Age', 0, 120, 1, '', 'years'),
  choiceField('sex', 'Sex used by the equation', [['', 'Choose'], ['female', 'Female'], ['male', 'Male']]),
  numberField('heightCm', 'Height', 50, 250, 'any', '', 'cm'),
  numberField('weightKg', 'Weight', 10, 500, 'any', '', 'kg'),
  choiceField('activity.pal', 'Activity · PAL', [['', 'Choose'], ['1.4', '1.4 · Mostly sedentary'], ['1.6', '1.6 · Lightly active'], ['1.8', '1.8 · Active'], ['2', '2.0 · Very active']]),
  choiceField('activity.cnClass', 'Activity · China DRIs', [['', 'Choose'], ['light', 'Light'], ['moderate', 'Moderate'], ['heavy', 'Heavy']]),
  numberField('referenceWeightKg', 'Reference weight', 10, 500, 'any', 'Normal reference weight for protein calculations. Required outside the standard’s reference BMI range.', 'kg'),
  numberField('training.weeklyHours', 'Training', 0, 168, 'any', '', 'h/week'),
  choiceField('training.carbohydrateLoad', 'Training load', [['', 'Choose'], ['low', 'Low · light / skill activity'], ['moderate', 'Moderate · about 1 h / day'], ['high', 'High · 1–3 h / day'], ['very_high', 'Very high · 4–5 h / day']]),
  choiceField('scope', 'Nutrition context', [['general', 'General adult nutrition'], ['pregnant', 'Pregnancy'], ['lactating', 'Breastfeeding'], ['requiresTherapeuticDiet', 'Therapeutic diet']]),
];
export const PLAN_FIELDS = [
  numberField('lunchPercent', 'Lunch', 0, 100, 'any', '', '%'),
  numberField('dinnerPercent', 'Dinner', 0, 100, 'any', '', '%'),
  numberField('energyKcal', 'Daily energy', 1, 20000, 'any', 'For clinical standards, enter maintenance energy before the deficit.', 'kcal'),
  numberField('deficitKcal', 'Planned deficit', 1, 5000, 'any', 'Enter the deficit from your agreed nutrition plan.', 'kcal/day'),
];
export const SETTING_FIELDS = [
  choiceField('standard', 'Nutrition standard', Object.entries(STANDARDS)),
  choiceField('energyMethod', 'Energy calculation', [['standard', 'Standard’s own method'], ['mifflin1990', 'Mifflin–St Jeor (1990)'], ['henry2005', 'Henry (2005)'], ['provided', 'Use my daily energy']]),
  choiceField('proteinMealStrategy', 'Protein per meal', [['proportional', 'Use meal allocation'], ['issn_weight_dose', 'ISSN · 0.25 g / kg'], ['issn_absolute_dose', 'ISSN · 20–40 g']]),
  choiceField('s3MacroPolicy', 'Macronutrient approach', [['individualized', 'Individualized · no fixed targets'], ['dge_general', 'DGE orientation'], ['dge_physically_active', 'DGE · physically active']]),
];
// Plain explanation shown under the standard menu, above Energy calculation.
// `lead` is the standard name’s first word; the UI places the source links beside it.
export const STANDARD_CLOSING = 'Lunch and dinner shares are for planning. A reference amount is not an upper limit. Total sugar on the menu is not compared with free-sugar or added-sugar advice.';
export const STANDARD_NOTES = {
  efsa: {lead: 'EFSA', wiki: 'https://en.wikipedia.org/wiki/European_Food_Safety_Authority', official: 'https://www.efsa.europa.eu/en/topics/topic/dietary-reference-values',
    body: 'DRVs read daily energy from a table for your age, sex and activity. Your weight and height do not change that table.'},
  dge_oege: {lead: 'DGE/ÖGE', wiki: 'https://de.wikipedia.org/wiki/Deutsche_Gesellschaft_für_Ernährung', official: 'https://www.dge.de/wissenschaft/referenzwerte/',
    body: 'estimates daily energy from age, sex, weight and activity from age 19. At 18 it uses an age and sex table instead.'},
  ch_blv: {lead: 'Swiss', wiki: 'https://de.wikipedia.org/wiki/Bundesamt_für_Lebensmittelsicherheit_und_Veterinärwesen', official: 'https://www.blv.admin.ch/de/naehrstoffzufuhr',
    body: 'BLV gives an energy range for your age and sex. Weight, height and activity do not change that table.'},
  cn_dri_2023: {lead: 'China', wiki: 'https://zh.wikipedia.org/wiki/中国营养学会', official: 'https://www.cnsoc.org/drpostand/',
    body: 'DRIs 2023 look up daily energy by age, sex and activity class. The number comes from a group table, not from your weight and height.'},
  us_nasem: {lead: 'NASEM', wiki: 'https://en.wikipedia.org/wiki/National_Academies_of_Sciences,_Engineering,_and_Medicine', official: 'https://www.nationalacademies.org/projects/HMD-FNB-21-04/publication/26818',
    body: 'estimates daily energy from age, sex, height, weight and activity. Activity chooses the equation. It is not multiplied on again afterwards.'},
  us_dga_2025: {lead: 'DGA', wiki: 'https://en.wikipedia.org/wiki/Dietary_Guidelines_for_Americans', official: 'https://www.dietaryguidelines.gov/',
    body: '2025–2030 does not include its own energy equation here. Choose another equation, or enter your daily energy. Protein uses your actual weight, and added sugar is limited per meal.'},
  who: {lead: 'WHO', wiki: 'https://en.wikipedia.org/wiki/World_Health_Organization', official: 'https://www.who.int/news-room/fact-sheets/detail/healthy-diet',
    body: 'sets limits for fat, salt, fibre and free sugar. It does not define daily energy or one protein number, so choose an energy calculation.'},
  dge_sport: {lead: 'DGE', wiki: 'https://de.wikipedia.org/wiki/Deutsche_Gesellschaft_für_Ernährung', official: 'https://www.dge.de/presse/meldungen/2020/positionspapier-zur-proteinzufuhr-im-sport/',
    body: 'sport 2020 gives a higher protein range only when you train more than 5 hours a week. It does not estimate energy from those hours.'},
  issn: {lead: 'ISSN', wiki: 'https://en.wikipedia.org/wiki/Sports_nutrition', official: 'https://www.sportsnutritionsociety.org/',
    body: 'gives a daily protein range for healthy people who train, and a choice for how to count protein at each meal. It does not estimate energy.'},
  acsm: {lead: 'AND/DC/ACSM', wiki: 'https://en.wikipedia.org/wiki/Academy_of_Nutrition_and_Dietetics', official: 'https://pubmed.ncbi.nlm.nih.gov/26920240/',
    body: '2016 gives protein, fat and carbohydrate ranges for training. Carbohydrate follows the training load you choose for that day. Energy still needs its own calculation.'},
  nice_ng246: {lead: 'NICE', wiki: 'https://en.wikipedia.org/wiki/National_Institute_for_Health_and_Care_Excellence', official: 'https://www.nice.org.uk/guidance/ng246',
    body: 'NG246 plans an energy deficit from your maintenance energy. Enter the deficit from your agreed plan. It does not list targets for the other nutrients.'},
  dag_s3_2024: {lead: 'German', wiki: 'https://de.wikipedia.org/wiki/Deutsche_Adipositas-Gesellschaft', official: 'https://register.awmf.org/de/leitlinien/detail/050-001',
    body: 'S3 obesity guidance plans an energy deficit from maintenance energy. The guideline usually suggests about 500–600 kcal a day; enter the deficit from your agreed plan. Macronutrients can stay individual, or follow a DGE orientation.'},
  cn_obesity_2024: {lead: 'China', wiki: 'https://en.wikipedia.org/wiki/National_Health_Commission', official: 'https://www.cnsoc.org/images/@cmsxh_7108bb5a-13de-4356-a2a9-50d178413c39.pdf',
    body: 'NHC obesity guidance applies when BMI is at least 24. It lowers maintenance energy by 30–50%. It is not a target for every adult.'},
};
export function readPath(object, path) { return path.split('.').reduce((value, key) => value?.[key], object); }
export function writePath(object, path, value) {
  const keys = path.split('.');
  let target = object;
  for (const key of keys.slice(0, -1)) target = target[key] ||= {};
  if (value === undefined) delete target[keys.at(-1)];
  else target[keys.at(-1)] = value;
  for (const key of Object.keys(object)) if (object[key] && typeof object[key] === 'object' && !Object.keys(object[key]).length) delete object[key];
}
export function fieldValue(field, raw) {
  if (raw === '') return undefined;
  if (field.type === 'select') {
    if (!field.options.some(([value]) => String(value) === String(raw))) throw new Error('Choose an available option.');
    return field.key === 'activity.pal' ? Number(raw) : raw;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < field.min || value > field.max || (field.step === 1 && !Number.isInteger(value)))
    throw new Error(`Enter ${field.step === 1 ? 'a whole number' : 'a number'} from ${field.min} to ${field.max}.`);
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
    const description = refs.map(r => `${r.referenceType}: ${amountText(r.amount, metric.unit)} (${r.kind.replaceAll('_', ' ')})`).join('; ');
    const label = limit ? 'budget' : range ? 'range' : ref.kind === 'minimum' ? 'minimum' : 'reference';
    return [[key, {ref, limit, range, label, amount: amountText(ref.amount, metric.unit), description}]];
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
  let tone = 'met', status;
  if (limit) {
    tone = above ? 'high' : 'met';
    status = above ? 'Above budget' : low !== high && total >= low ? 'Within budget interval' : 'Within budget';
  } else if (below) { tone = 'low'; status = 'Below ' + (range ? 'range' : 'reference'); }
  else if (above && (range || key === 'kcal')) { tone = 'high'; status = 'Above ' + (range ? 'range' : 'plan'); }
  else status = range ? 'In range' : 'Reference covered';
  const percent = Math.round(total / high * 100);
  return {tone, percent, fill: Math.min(1, total / high), status,
    description: `${status}. ${percent}% of ${target.amount} ${target.label}. ${target.description}. Meal planning reference, not a per-meal safety threshold.`};
}
