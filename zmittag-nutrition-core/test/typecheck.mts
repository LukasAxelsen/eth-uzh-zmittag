import { calculateTargets, calculateEnergy, createHallModel, simulateHall, planHallEnergy,
  type UserProfile, type CalculationResult, type Metric } from '../core.mjs';
const profile: UserProfile = { ageYears: 30, sex: 'male', heightCm: 180, weightKg: 75, activity: { pal: 1.6 } };
const result: CalculationResult = calculateTargets({ standard: 'us_nasem', profile,
  allocation: { kind: 'explicit', lunch: .4, dinner: .3 } });
const energy: Metric = calculateEnergy({ method: 'provided', kcal: 2000, label: 'test', profile });
const model = createHallModel({ ...profile, weightKg: 90, fatMassKg: 25 },
  { maintenanceEnergyKcal: 2700, carbohydrateKcal: 1350, ecfLitres: 18 });
simulateHall(model, { energyKcalPerDay: 2200, carbohydrateKcalPerDay: 1100,
  sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 }, { days: 90 });
const plan = planHallEnergy(model, { targetWeightKg: 85, days: 90, minIntakeKcal: 1800, maxIntakeKcal: 2700,
  carbEnergyFraction: .5, sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 });
if (plan.status === 'ok') console.log(result.standard, energy.status, plan.energyKcalPerDay);
