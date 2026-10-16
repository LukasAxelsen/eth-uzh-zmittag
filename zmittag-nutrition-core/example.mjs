import { calculateTargets, calculateEnergy, createHallModel, simulateHall, planHallEnergy } from './core.mjs';

const profile = { ageYears: 30, sex: 'male', heightCm: 180, weightKg: 75, activity: { pal: 1.6 },
  training: { weeklyHours: 6, carbohydrateLoad: 'moderate' } };
const allocation = { kind: 'explicit', lunch: .4, dinner: .3 };
const compact = result => Object.fromEntries(['daily', 'lunch', 'dinner'].map(period => [period,
  Object.fromEntries(Object.entries(result[period]).map(([key, m]) => [key, {
    status: m.status, unit: m.unit,
    references: m.references.map(r => ({ type: r.referenceType, kind: r.kind, amount: r.amount,
      ...(r.analyte ? { analyte: r.analyte } : {}) }))
  }]))]));

const national = calculateTargets({ standard: 'us_nasem', profile, allocation });
console.log('NASEM, explicit 40% lunch / 30% dinner (demonstration policy):');
console.log(JSON.stringify(compact(national), null, 2));

const china = calculateTargets({ standard: 'cn_dri_2023', profile: { ...profile, activity: { cnClass: 'light' } }, allocation });
console.log('Chinese native EER:', china.daily.kcal.references[0].amount);

const athlete = calculateTargets({ standard: 'issn', profile, allocation, proteinMealStrategy: 'issn_weight_dose' });
console.log('ISSN independent daily range and native per-meal alternative:', {
  daily: athlete.daily.protein.references, lunch: athlete.lunch.protein.references, dinner: athlete.dinner.protein.references
});

// Explicit composition: plan energy with S3, then use that energy in EFSA.
// No automatic merging of conflicting protein or macro recommendations.
const plan = calculateTargets({ standard: 'dag_s3_2024', profile, allocation,
  energy: { method: 'provided', kcal: 2400, label: 'Explicit maintenance estimate for demonstration' },
  clinicalPlan: { kind: 'deficit_kcal', amount: 500 } });
const plannedEfsa = calculateTargets({ standard: 'efsa', profile, allocation,
  energy: { method: 'provided', kcal: plan.daily.kcal.references[0].amount, label: 'S3 energy plan: maintenance 2400 minus 500' } });
console.log('EFSA with explicitly planned energy:', { energy: plannedEfsa.daily.kcal.references,
  protein: plannedEfsa.daily.protein.references, fibre: plannedEfsa.daily.fiber.references });
console.log('Separately selected Mifflin estimate:', calculateEnergy({ method: 'mifflin1990', profile }).references);

// ECF, baseline carbohydrate energy and maintenance energy below are supplied
// demonstration inputs, not recommended defaults or measurements of this user.
const model = createHallModel({ ...profile, weightKg: 90, fatMassKg: 25 },
  { maintenanceEnergyKcal: 2700, carbohydrateKcal: 1350, ecfLitres: 18 });
const forward = simulateHall(model, { energyKcalPerDay: 2200, carbohydrateKcalPerDay: 1100,
  sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 }, { days: 90 });
const inverse = planHallEnergy(model, { targetWeightKg: forward.weightKg, days: 90,
  minIntakeKcal: 1800, maxIntakeKcal: 2700, carbEnergyFraction: .5,
  sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 });
console.log('Published Hall 2011 model forward / inverse demonstration:', {
  weightAt90DaysKg: forward.weightKg, inverseStatus: inverse.status,
  recoveredEnergyKcal: inverse.status === 'ok' ? inverse.energyKcalPerDay : null
});
