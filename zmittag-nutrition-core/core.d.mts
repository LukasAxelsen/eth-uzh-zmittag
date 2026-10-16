/** Completed years; published binary sex categories are equation inputs, not gender identity. */
export interface UserProfile {
  ageYears?: number;
  sex?: 'male' | 'female';
  weightKg?: number;
  heightCm?: number;
  /** Explicit normal reference weight. Actual weight is reused only if BMI is in [18.5,25). */
  referenceWeightKg?: number;
  fatMassKg?: number;
  activity?: { pal?: number; cnClass?: 'light' | 'moderate' | 'heavy' };
  training?: { weeklyHours?: number; carbohydrateLoad?: 'low' | 'moderate' | 'high' | 'very_high' };
  pregnant?: boolean;
  lactating?: boolean;
  requiresTherapeuticDiet?: boolean;
}
export interface Interval { low: number; high: number }
export type Nutrient = 'kcal' | 'protein' | 'fat' | 'saturated' | 'carbs' | 'sugar' | 'salt' | 'fiber';
export type Standard = 'efsa' | 'dge_oege' | 'ch_blv' | 'cn_dri_2023' | 'us_nasem' | 'us_dga_2025' |
  'who' | 'dge_sport' | 'issn' | 'acsm' | 'nice_ng246' | 'dag_s3_2024' | 'cn_obesity_2024';
export type EnergyInput =
  | { method: 'provided'; kcal: number | Interval; label: string }
  | { method: 'efsa_table' | 'dge_ree' | 'ch_table' | 'cn_table' | 'nasem2023' | 'mifflin1990' | 'henry2005' };
export type Allocation =
  | { kind: 'explicit'; lunch: number; dinner: number }
  | { kind: 'dge_quarters' | 'cn_obesity_343' };
export type ClinicalPlan =
  | { kind: 'deficit_kcal'; amount: number | Interval }
  | { kind: 'guideline_deficit' | 'guideline_fraction' | 'sex_band' }
  | { kind: 'bmi_reduction'; restingKcal: number }
  | { kind: 'ideal_weight'; activity: 'bed_rest' | 'light' | 'moderate' | 'heavy'; kcalPerIdealKg: number | Interval };
export interface CalculationRequest {
  standard: Standard;
  profile: UserProfile;
  allocation?: Allocation;
  /** For a clinical profile, this is MAINTENANCE energy, before the selected deficit. */
  energy?: EnergyInput;
  clinicalPlan?: ClinicalPlan;
  whoSugarLevel?: 'standard_10_percent' | 'conditional_5_percent';
  proteinMealStrategy?: 'proportional' | 'issn_weight_dose' | 'issn_absolute_dose';
  s3MacroPolicy?: 'individualized' | 'dge_general' | 'dge_physically_active';
}
export interface Reference {
  kind: 'reference' | 'reference_range' | 'intake_range' | 'minimum' | 'maximum' | 'reduction_threshold' | 'meal_dose';
  referenceType: string;
  /** A quantity or uncertainty interval. For a maximum, low is NOT a minimum intake. */
  amount: Interval;
  sources: string[];
  formula: string;
  period?: 'day' | 'meal';
  analyte?: string;
  upperInclusive?: boolean;
  lowerInclusive?: boolean;
  populationReference?: boolean;
  energyFraction?: { low: number | null; high: number | null };
  energyKcal?: Interval;
  uncertainEnergy?: boolean;
  sodiumMg?: Interval;
  gramsPerKg?: Interval;
  weightKg?: number;
  weightBasis?: 'normal_reference' | 'actual';
  dailyAmount?: Interval;
  share?: number;
  meal?: 'lunch' | 'dinner';
  projection?: 'daily_reference_planning_allocation' | 'native_per_meal';
  [key: string]: unknown;
}
export interface Metric {
  unit: 'kcal' | 'g';
  analyte: string;
  status: 'ok' | 'partial' | 'requires_input' | 'qualitative' | 'not_defined' | 'not_comparable' | 'out_of_scope';
  references: Reference[];
  missingInputs: string[];
  notes: string[];
  sources?: string[];
}
export type NutrientTargets = Record<Nutrient, Metric>;
export interface CalculationResult {
  version: string;
  standard: Standard;
  standardName: string;
  snapshotDate: string;
  allocation: null | { lunch: number; dinner: number; unallocated: number; provenance: string; source?: string };
  daily: NutrientTargets;
  lunch: NutrientTargets;
  dinner: NutrientTargets;
  notes: string[];
}
export declare const VERSION: string;
export declare const NUTRIENTS: readonly Nutrient[];
export declare const STANDARDS: Readonly<Record<Standard, string>>;
export declare const SOURCES: Readonly<Record<string, { title: string; version: string; url: string }>>;
export declare function validateProfile(p: UserProfile): UserProfile;
export declare function calculateTargets(request: CalculationRequest): CalculationResult;
export declare function calculateEnergy(input: EnergyInput & { profile: UserProfile }): Metric;

export interface HallState { fatKg: number; leanKg: number; glycogenKg: number; ecfLitres: number; adaptiveKcal: number }
export interface HallBaseline { maintenanceEnergyKcal: number; carbohydrateKcal: number; ecfLitres: number; glycogenKg?: number }
export interface HallModel {
  readonly version: 'hall_2011_eq_1_9';
  readonly initial: Readonly<HallState>;
  readonly baseline: Readonly<Required<HallBaseline>>;
  readonly deltaKcalPerKgDay: number;
  readonly calibrationKcal: number;
  readonly initialWeightKg: number;
  readonly fatMassBasis: string;
  readonly notes: readonly string[];
}
export interface HallIntervention {
  energyKcalPerDay: number;
  carbohydrateKcalPerDay: number;
  sodiumChangeMgPerDay: number;
  activityChangeKcalPerKgDay: number;
}
export interface HallSimulation {
  days: number; state: HallState; weightKg: number; expenditureKcal: number;
  integratedEnergyBalanceKcal: number; numericalMethod: 'RK4'; stepDays: number;
}
export interface HallGoal {
  targetWeightKg: number; days: number; minIntakeKcal: number; maxIntakeKcal: number;
  carbEnergyFraction: number; sodiumChangeMgPerDay: number; activityChangeKcalPerKgDay: number;
  stepDays?: number; energyToleranceKcal?: number;
}
export declare const HALL_CONSTANTS: Readonly<Record<string, number>>;
export declare function estimateHallFatMass(profile: UserProfile): number;
export declare function createHallModel(profile: UserProfile, baseline: HallBaseline): HallModel;
export declare function hallWeight(state: HallState): number;
export declare function hallDerivatives(model: HallModel, state: HallState, intervention: HallIntervention): HallState & { expenditureKcal: number };
export declare function simulateHall(model: HallModel, intervention: HallIntervention,
  options: { days: number; stepDays?: number; maxSteps?: number }): HallSimulation;
export declare function planHallEnergy(model: HallModel, goal: HallGoal):
  | { status: 'target_not_bracketed'; endpointWeightsKg: [number, number] }
  | { status: 'ok'; energyKcalPerDay: number; simulation: HallSimulation; iterations: number;
      energyBracketKcal: [number, number]; source: 'hall'; modelVersion: string;
      assumptions: Pick<HallGoal, 'carbEnergyFraction' | 'sodiumChangeMgPerDay' | 'activityChangeKcalPerKgDay'> };
