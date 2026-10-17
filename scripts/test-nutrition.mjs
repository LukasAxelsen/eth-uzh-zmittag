import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {DEFAULT_NUTRITION, STANDARDS, STANDARD_NOTES, FieldError, PROFILE_FIELDS, calculatePlan, coverageTargets, coverage,
  fieldValue, sanitizeProfile, sanitizeNutrition, validNutritionPreferences} from '../template/nutrition.mjs';
const en = JSON.parse(readFileSync(new URL('../template/i18n/en.json', import.meta.url), 'utf8'));
const profile = {ageYears: 30, sex: 'male', heightCm: 180, weightKg: 75,
  activity: {pal: 1.6, cnClass: 'moderate'}, training: {weeklyHours: 7, carbohydrateLoad: 'high'}};

test('every supplied standard is available without fabricating missing nutrients', () => {
  for (const standard of Object.keys(STANDARDS)) {
    const settings = {...DEFAULT_NUTRITION, standard, energyMethod: 'provided', energyKcal: 2400, deficitKcal: 500};
    const result = calculatePlan({...profile, weightKg: standard === 'cn_obesity_2024' ? 90 : 75}, settings);
    assert.equal(result.standard, standard);
    assert.equal(Object.keys(result.lunch).length, 8);
    assert.ok(result.lunch.kcal.references.length);
  }
  const who = calculatePlan(profile, {...DEFAULT_NUTRITION, standard: 'who'});
  assert.equal(who.lunch.kcal.status, 'requires_input');
  assert.equal(coverageTargets(who.lunch).protein, undefined);
});
test('only actual serving totals compare; zero survives, sugar and weight do not', () => {
  const targets = coverageTargets(calculatePlan(profile, DEFAULT_NUTRITION).lunch);
  for (const value of [undefined, null, '', '30', NaN, Infinity, -1]) assert.equal(coverage(value, targets.protein, 'protein'), null);
  assert.equal(coverage(0, targets.protein, 'protein').fill, 0);
  assert.equal(coverage(0, targets.protein, 'protein').tone, 'low');
  assert.equal(targets.sugar, undefined);
  assert.equal(targets.weight, undefined);
});
test('reference intakes never become upper limits; salt budget takes priority over AI', () => {
  const targets = coverageTargets(calculatePlan(profile, DEFAULT_NUTRITION).lunch);
  assert.equal(coverage(100, targets.protein, 'protein').tone, 'met');
  assert.equal(coverage(24.9, targets.protein, 'protein').tone, 'met', 'floating-point roundoff is not a deficit');
  assert.equal(coverage(0, targets.salt, 'salt').tone, 'met');
  assert.equal(coverage(3, targets.salt, 'salt').tone, 'high');
  assert.equal(targets.salt.ref.kind, 'maximum');
  assert.ok(targets.salt.references.some(r => r.type === 'AI'), 'the AI stays in the accessible description');
  assert.equal(coverage(3, targets.salt, 'salt').statusKey, 'coverage.status.aboveBudget');
  assert.equal(coverage(100, targets.fat, 'fat').tone, 'high');
});
test('lunch/dinner allocation and native ISSN meal doses remain distinct', () => {
  const result = calculatePlan(profile, DEFAULT_NUTRITION);
  assert.ok(Math.abs(result.lunch.protein.references[0].amount.high / result.dinner.protein.references[0].amount.high - 4/3) < 1e-10);
  const issn = calculatePlan(profile, {...DEFAULT_NUTRITION, standard: 'issn', proteinMealStrategy: 'issn_absolute_dose'});
  assert.deepEqual(issn.lunch.protein.references[0].amount, {low: 20, high: 40});
});
test('out-of-scope and missing profile data never display a made-up plan', () => {
  for (const p of [{}, {...profile, ageYears: 17}, {...profile, pregnant: true}, {...profile, requiresTherapeuticDiet: true}]) {
    assert.deepEqual(coverageTargets(calculatePlan(p, DEFAULT_NUTRITION).lunch), {});
  }
  assert.doesNotThrow(() => calculatePlan(profile, {...DEFAULT_NUTRITION, standard: 'cn_dri_2023'}));
  assert.throws(() => calculatePlan(profile, {...DEFAULT_NUTRITION, lunchPercent: 90, dinnerPercent: 30}));
});
test('every standard has a plain explanation and source links on its first word', () => {
  assert.deepEqual(Object.keys(STANDARD_NOTES).sort(), Object.keys(STANDARDS).sort());
  assert.match(en['note.closing'], /not an upper limit/);
  for (const [id, note] of Object.entries(STANDARD_NOTES)) {
    assert.equal(en[note.leadKey], STANDARDS[id].split(' ')[0]);
    assert.equal(en['standard.' + id], STANDARDS[id], 'English option names match the core');
    assert.ok(en[note.bodyKey].length > 40, id);
    assert.match(note.wiki, /^https:\/\/[a-z]{2}\.wikipedia\.org\/wiki\//);
    assert.match(note.official, /^https:\/\//);
  }
});
test('validation failures are catalog keys, translated where they are shown', () => {
  const age = PROFILE_FIELDS.find(field => field.key === 'ageYears');
  assert.throws(() => fieldValue(age, '30.5'), error => error instanceof FieldError &&
    error.key === 'error.wholeNumber' && error.params.min === 0 && error.params.max === 120 && Boolean(en[error.key]));
  const sex = PROFILE_FIELDS.find(field => field.key === 'sex');
  assert.throws(() => fieldValue(sex, 'other'), error => error.key === 'error.chooseOption');
});
test('storage upgrades, invalid values and nested remote validation', () => {
  assert.deepEqual(sanitizeNutrition(undefined), DEFAULT_NUTRITION);
  assert.deepEqual(sanitizeProfile({ageYears: 'bad', weightKg: -1, sex: 'unknown'}), {});
  assert.equal(sanitizeNutrition({standard: 'invented', lunchPercent: 90, dinnerPercent: 90}).lunchPercent, 40);
  assert.equal(validNutritionPreferences({}), true);
  assert.equal(validNutritionPreferences({userProfile: profile, nutritionSettings: DEFAULT_NUTRITION}), true);
  assert.equal(validNutritionPreferences({userProfile: {...profile, activity: {pal: 999}}}), false);
  assert.equal(validNutritionPreferences({userProfile: {...profile, training: {weeklyHours: 7, secret: 'bad'}}}), false);
  assert.equal(validNutritionPreferences({nutritionSettings: {...DEFAULT_NUTRITION, energyKcal: -1}}), false);
});
