/**
 * Hall et al. (2011), peer-reviewed appendix equations 1–9.
 * Units inside the solver: kcal, kg, litres, days, mg sodium.
 * This implements that published model, not a claim of parity with later BWP releases.
 */
const KJ_PER_KCAL = 4.184;
export const HALL_CONSTANTS = Object.freeze({
  rhoG: 17600 / KJ_PER_KCAL,
  rhoF: 39500 / KJ_PER_KCAL,
  rhoL: 7600 / KJ_PER_KCAL,
  gammaF: 13 / KJ_PER_KCAL,
  gammaL: 92 / KJ_PER_KCAL,
  etaF: 750 / KJ_PER_KCAL,
  etaL: 960 / KJ_PER_KCAL,
  betaTEF: 0.1, betaAT: 0.14, tauAT: 14,
  sodiumMgPerLitre: 3220, xiNa: 3000, xiCI: 4000,
  glycogenWaterRatio: 2.7, forbesKg: 10.4
});

function number(x, name, lo = -Infinity, hi = Infinity) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < lo || x > hi) {
    throw new RangeError(name + ' must be a finite number in [' + lo + ', ' + hi + ']');
  }
  return x;
}
function positive(x, name) {
  number(x, name);
  if (x <= 0) throw new RangeError(name + ' must be > 0');
  return x;
}

/** Initial fat mass using appendix equation 4; an estimate, not a measurement. */
export function estimateHallFatMass(profile) {
  const { ageYears: a, heightCm: h, weightKg: w, sex } = profile;
  number(a, 'ageYears', 18); positive(h, 'heightCm'); positive(w, 'weightKg');
  if (!['male', 'female'].includes(sex)) throw new RangeError('sex must be male or female');
  const bmi = w / (h / 100) ** 2;
  const percent = 0.14 * a +
    (sex === 'male' ? 37.31 * Math.log(bmi) - 103.94 : 39.96 * Math.log(bmi) - 102.01);
  const fat = w * percent / 100;
  if (!(fat > 0 && fat < w)) throw new RangeError('Jackson fat estimate is outside the model domain');
  return fat;
}

/**
 * baseline contains maintenanceEnergyKcal, carbohydrateKcal, ecfLitres,
 * and optionally glycogenKg (appendix approximation: 0.5 kg).
 * No baseline ECF, carbohydrate intake, or maintenance energy is silently inferred.
 */
export function createHallModel(profile, baseline) {
  if (!baseline || typeof baseline !== 'object') throw new TypeError('baseline is required');
  number(profile.ageYears, 'ageYears', 18);
  if (profile.pregnant === true || profile.lactating === true ||
      profile.requiresTherapeuticDiet === true) throw new RangeError('Outside the healthy non-pregnant adult scope');
  const w = positive(profile.weightKg, 'weightKg');
  const pal = number(profile.activity?.pal, 'activity.pal', 1.2, 2.5);
  const e = positive(baseline.maintenanceEnergyKcal, 'maintenanceEnergyKcal');
  const ci = positive(baseline.carbohydrateKcal, 'carbohydrateKcal');
  if (ci > e) throw new RangeError('Baseline carbohydrate energy cannot exceed total energy');
  const ecf = positive(baseline.ecfLitres, 'ecfLitres');
  const g = positive(baseline.glycogenKg ?? 0.5, 'glycogenKg');
  const fat = profile.fatMassKg === undefined
    ? estimateHallFatMass(profile) : positive(profile.fatMassKg, 'fatMassKg');
  const c = HALL_CONSTANTS;
  // Water density is represented as 1 kg/L in this compartment model.
  const lean = w - fat - ecf - (1 + c.glycogenWaterRatio) * g;
  if (!(lean > 0)) throw new RangeError('Initial compartments exceed total body mass');
  // Eq. 8, with RMR = maintenanceEnergy / PAL.
  const delta = ((1 - c.betaTEF) * pal - 1) * (e / pal) / w;
  const calibrationK = e - c.gammaF * fat - c.gammaL * lean - delta * w;
  return Object.freeze({
    version: 'hall_2011_eq_1_9',
    initial: Object.freeze({ fatKg: fat, leanKg: lean, glycogenKg: g, ecfLitres: ecf, adaptiveKcal: 0 }),
    baseline: Object.freeze({ maintenanceEnergyKcal: e, carbohydrateKcal: ci, ecfLitres: ecf, glycogenKg: g }),
    deltaKcalPerKgDay: delta, calibrationKcal: calibrationK, initialWeightKg: w,
    fatMassBasis: profile.fatMassKg === undefined ? 'jackson_eq4_estimate' : 'provided',
    notes: ['Glycogen carries 2.7 kg water/kg; ECF is represented at 1 kg/L.',
      'Calibration starts at energy balance; it is not a measured metabolic diagnosis.']
  });
}

function validateIntervention(x) {
  if (!x || typeof x !== 'object') throw new TypeError('intervention is required');
  positive(x.energyKcalPerDay, 'energyKcalPerDay');
  positive(x.carbohydrateKcalPerDay, 'carbohydrateKcalPerDay');
  if (x.carbohydrateKcalPerDay > x.energyKcalPerDay) throw new RangeError('Carbohydrate energy exceeds total energy');
  number(x.sodiumChangeMgPerDay, 'sodiumChangeMgPerDay');
  number(x.activityChangeKcalPerKgDay, 'activityChangeKcalPerKgDay');
}

export function hallWeight(state) {
  return state.fatKg + state.leanKg + state.ecfLitres +
    (1 + HALL_CONSTANTS.glycogenWaterRatio) * state.glycogenKg;
}

/** Instantaneous derivatives and energy expenditure, appendix eqs. 1–9. */
export function hallDerivatives(model, state, intervention) {
  validateIntervention(intervention);
  if (model.version !== 'hall_2011_eq_1_9') throw new RangeError('Unsupported Hall model version');
  for (const k of ['fatKg', 'leanKg', 'glycogenKg', 'ecfLitres']) positive(state[k], k);
  number(state.adaptiveKcal, 'adaptiveKcal');
  const c = HALL_CONSTANTS;
  const b = model.baseline;
  const ei = intervention.energyKcalPerDay, ci = intervention.carbohydrateKcalPerDay;
  const dg = (ci - b.carbohydrateKcal / b.glycogenKg ** 2 * state.glycogenKg ** 2) / c.rhoG;
  const decf = (intervention.sodiumChangeMgPerDay -
    c.xiNa * (state.ecfLitres - b.ecfLitres) -
    c.xiCI * (1 - ci / b.carbohydrateKcal)) / c.sodiumMgPerLitre;
  const C = c.forbesKg * c.rhoL / c.rhoF;
  const p = C / (C + state.fatKg);
  const eta = p * c.etaL / c.rhoL + (1 - p) * c.etaF / c.rhoF;
  const delta = model.deltaKcalPerKgDay + intervention.activityChangeKcalPerKgDay;
  if (delta < 0) throw new RangeError('Negative physical activity parameter');
  const deltaEI = ei - b.maintenanceEnergyKcal;
  // TEF is the change from baseline (eq. 6), not another 10% of total EI.
  const tefChange = c.betaTEF * deltaEI;
  const ee = (model.calibrationKcal + c.gammaF * state.fatKg + c.gammaL * state.leanKg +
    delta * hallWeight(state) + tefChange + state.adaptiveKcal +
    (ei - c.rhoG * dg) * eta) / (1 + eta);
  return {
    fatKg: (1 - p) * (ei - ee - c.rhoG * dg) / c.rhoF,
    leanKg: p * (ei - ee - c.rhoG * dg) / c.rhoL,
    glycogenKg: dg, ecfLitres: decf,
    adaptiveKcal: (c.betaAT * deltaEI - state.adaptiveKcal) / c.tauAT,
    expenditureKcal: ee
  };
}

const STATE_KEYS = ['fatKg', 'leanKg', 'glycogenKg', 'ecfLitres', 'adaptiveKcal'];
function shifted(state, rate, scale) {
  return Object.fromEntries(STATE_KEYS.map(k => [k, state[k] + scale * rate[k]]));
}

/** Fixed-step RK4, with an exact final fractional step. No I/O or external state. */
export function simulateHall(model, intervention, options) {
  validateIntervention(intervention);
  const days = number(options?.days, 'days', 0, 36500);
  const step = number(options?.stepDays ?? 0.25, 'stepDays', 1 / 1024, 0.5);
  const maxSteps = options?.maxSteps ?? 1000000;
  if (!Number.isInteger(maxSteps) || maxSteps < 1) throw new RangeError('maxSteps must be a positive integer');
  if (Math.ceil(days / step) > maxSteps) throw new RangeError('Requested simulation exceeds maxSteps');
  let state = { ...model.initial }, t = 0, integratedBalance = 0;
  while (t < days) {
    const dt = Math.min(step, days - t);
    const a = hallDerivatives(model, state, intervention);
    const b = hallDerivatives(model, shifted(state, a, dt / 2), intervention);
    const c = hallDerivatives(model, shifted(state, b, dt / 2), intervention);
    const d = hallDerivatives(model, shifted(state, c, dt), intervention);
    const next = {};
    for (const k of STATE_KEYS) next[k] = state[k] + dt * (a[k] + 2 * b[k] + 2 * c[k] + d[k]) / 6;
    integratedBalance += dt * (intervention.energyKcalPerDay -
      (a.expenditureKcal + 2 * b.expenditureKcal + 2 * c.expenditureKcal + d.expenditureKcal) / 6);
    state = next;
    if (!(state.fatKg > 0 && state.leanKg > 0 && state.glycogenKg > 0 && state.ecfLitres > 0)) {
      throw new RangeError('Intervention leaves the positive-compartment model domain');
    }
    t += dt;
  }
  const end = hallDerivatives(model, state, intervention);
  return { days, state, weightKg: hallWeight(state), expenditureKcal: end.expenditureKcal,
    integratedEnergyBalanceKcal: integratedBalance, numericalMethod: 'RK4', stepDays: step };
}

/** Invert the published model for a constant dietary energy intervention. */
export function planHallEnergy(model, goal) {
  positive(goal?.targetWeightKg, 'targetWeightKg');
  positive(goal.days, 'days');
  const loInput = positive(goal.minIntakeKcal, 'minIntakeKcal');
  const hiInput = positive(goal.maxIntakeKcal, 'maxIntakeKcal');
  if (!(loInput < hiInput)) throw new RangeError('minIntakeKcal must be below maxIntakeKcal');
  const frac = number(goal.carbEnergyFraction, 'carbEnergyFraction', Number.EPSILON, 1);
  number(goal.sodiumChangeMgPerDay, 'sodiumChangeMgPerDay');
  number(goal.activityChangeKcalPerKgDay, 'activityChangeKcalPerKgDay');
  const tolerance = positive(goal.energyToleranceKcal ?? 0.05, 'energyToleranceKcal');
  const run = energy => simulateHall(model, {
    energyKcalPerDay: energy, carbohydrateKcalPerDay: energy * frac,
    sodiumChangeMgPerDay: goal.sodiumChangeMgPerDay,
    activityChangeKcalPerKgDay: goal.activityChangeKcalPerKgDay
  }, { days: goal.days, stepDays: goal.stepDays ?? 0.25 });
  let lo = loInput, hi = hiInput;
  const lowResult = run(lo), highResult = run(hi);
  if (lowResult.weightKg > highResult.weightKg) throw new RangeError('Non-monotone endpoint bracket');
  if (goal.targetWeightKg < lowResult.weightKg || goal.targetWeightKg > highResult.weightKg) {
    return { status: 'target_not_bracketed', endpointWeightsKg: [lowResult.weightKg, highResult.weightKg] };
  }
  let iterations = 0;
  while (hi - lo > tolerance && iterations < 80) {
    const mid = (lo + hi) / 2, result = run(mid);
    if (result.weightKg < goal.targetWeightKg) lo = mid; else hi = mid;
    iterations++;
  }
  const energy = (lo + hi) / 2;
  return { status: 'ok', energyKcalPerDay: energy, simulation: run(energy),
    iterations, energyBracketKcal: [lo, hi], source: 'hall',
    assumptions: { carbEnergyFraction: frac, sodiumChangeMgPerDay: goal.sodiumChangeMgPerDay,
      activityChangeKcalPerKgDay: goal.activityChangeKcalPerKgDay },
    modelVersion: model.version };
}

