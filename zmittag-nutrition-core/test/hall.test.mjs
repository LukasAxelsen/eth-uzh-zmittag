import test from 'node:test';
import assert from 'node:assert/strict';
import { createHallModel, hallDerivatives, simulateHall, planHallEnergy, HALL_CONSTANTS as C } from '../core.mjs';
const p = { ageYears: 35, sex: 'male', weightKg: 90, heightCm: 180, fatMassKg: 25, activity: { pal: 1.6 } };
const b = { maintenanceEnergyKcal: 2700, carbohydrateKcal: 1350, ecfLitres: 18 };
const model = createHallModel(p, b);
const intervention = { energyKcalPerDay: 2200, carbohydrateKcalPerDay: 1100, sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 };
const close = (a, z, eps = 1e-7) => assert.ok(Math.abs(a - z) <= eps, `${a} != ${z}`);

test('published-model baseline is an equilibrium over a year', () => {
  const i = { ...intervention, energyKcalPerDay: 2700, carbohydrateKcalPerDay: 1350 };
  const d = hallDerivatives(model, model.initial, i);
  for (const k of Object.keys(model.initial)) close(d[k], 0);
  const r = simulateHall(model, i, { days: 365 });
  close(r.weightKg, 90); close(r.expenditureKcal, 2700);
});
test('energy balance equals changes in stored fat, lean and glycogen energy', () => {
  const r = simulateHall(model, intervention, { days: 180 });
  const delta = C.rhoF * (r.state.fatKg - model.initial.fatKg) +
    C.rhoL * (r.state.leanKg - model.initial.leanKg) + C.rhoG * (r.state.glycogenKg - model.initial.glycogenKg);
  close(delta, r.integratedEnergyBalanceKcal, 1e-6);
  assert.ok(r.weightKg < 90 && r.expenditureKcal < 2700);
});
test('step halving converges and fractional last steps are integrated', () => {
  const a = simulateHall(model, intervention, { days: 90.125, stepDays: .25 });
  const b = simulateHall(model, intervention, { days: 90.125, stepDays: .125 });
  close(a.weightKg, b.weightKg, 1e-5);
  assert.equal(a.days, 90.125);
});
test('inverse model recovers a forward-generated target and detects unbracketed targets', () => {
  const forward = simulateHall(model, intervention, { days: 90 });
  const goal = { targetWeightKg: forward.weightKg, days: 90, minIntakeKcal: 1800, maxIntakeKcal: 2700,
    carbEnergyFraction: .5, sodiumChangeMgPerDay: 0, activityChangeKcalPerKgDay: 0 };
  const result = planHallEnergy(model, goal);
  assert.equal(result.status, 'ok'); close(result.energyKcalPerDay, 2200, .05);
  assert.equal(planHallEnergy(model, { ...goal, targetWeightKg: 100 }).status, 'target_not_bracketed');
});
test('unknown ECF and invalid intervention inputs are never silently filled or clamped', () => {
  assert.throws(() => createHallModel(p, { maintenanceEnergyKcal: 2700, carbohydrateKcal: 1350 }));
  assert.throws(() => simulateHall(model, { ...intervention, carbohydrateKcalPerDay: 3000 }, { days: 10 }));
  assert.throws(() => simulateHall(model, intervention, { days: 10, maxSteps: NaN }));
  assert.throws(() => simulateHall(model, intervention, { days: 10, stepDays: 1 }));
});
