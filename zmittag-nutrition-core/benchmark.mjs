import { performance } from 'node:perf_hooks';
import { calculateTargets, createHallModel, planHallEnergy } from './core.mjs';
const profile = { ageYears: 30, sex: 'male', heightCm: 180, weightKg: 75, activity: { pal: 1.6 } };
const req = { standard: 'us_nasem', profile, allocation: { kind: 'explicit', lunch: .4, dinner: .3 } };
for (let i = 0; i < 1000; i++) calculateTargets(req);
const count = 10000;
let t = performance.now();
for (let i = 0; i < count; i++) calculateTargets(req);
const ordinaryMs = performance.now() - t;
const model = createHallModel({ ...profile, weightKg: 90, fatMassKg: 25 },
  { maintenanceEnergyKcal: 2700, carbohydrateKcal: 1350, ecfLitres: 18 });
t = performance.now();
const plan = planHallEnergy(model, { targetWeightKg: 85, days: 90, minIntakeKcal: 1800, maxIntakeKcal: 2700,
  carbEnergyFraction: .5, sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 });
const hallMs = performance.now() - t;
console.log(JSON.stringify({ runtime: process.version, ordinary: { count, totalMs: ordinaryMs, perCallMs: ordinaryMs / count },
  hall90DayInverse: { elapsedMs: hallMs, status: plan.status },
  interpretation: 'Local machine measurement, not a phone/browser guarantee. Recalculate targets when profile/settings change, not per dish. Hall inverse can use a Web Worker.' }, null, 2));
