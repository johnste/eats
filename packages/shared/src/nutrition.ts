/**
 * Pure nutrition math, shared by the API and the web client so a number shown
 * next to an input matches the number the server stores.
 */

export const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type Meal = (typeof MEALS)[number];

export const SEXES = ['male', 'female'] as const;
export type Sex = (typeof SEXES)[number];

/** Mifflin-St Jeor multipliers, from sedentary to athlete. */
export const ACTIVITY_LEVELS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;
export type ActivityLevel = keyof typeof ACTIVITY_LEVELS;

export const ACTIVITY_LEVEL_KEYS = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
] as const satisfies readonly ActivityLevel[];

/** Energy per gram, used for both the goal split and the OCR sanity check. */
export const KCAL_PER_G = { protein: 4, carbs: 4, fat: 9 } as const;

/** 1 kcal = 4.184 kJ. EU labels lead with kJ, so we convert often. */
export const KJ_PER_KCAL = 4.184;

export interface Macros {
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

export const kjToKcal = (kj: number): number => kj / KJ_PER_KCAL;
export const kcalToKj = (kcal: number): number => kcal * KJ_PER_KCAL;

/** Round to `dp` decimal places without float dust (0.1 + 0.2 problems). */
export function round(value: number, dp = 1): number {
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/**
 * Scale per-100g values to an arbitrary gram amount. Every logged entry goes
 * through here, and the result is snapshotted onto the entry row.
 */
export function scaleMacros(per100g: Macros, grams: number): Macros {
  const f = grams / 100;
  return {
    kcal: round(per100g.kcal * f, 0),
    proteinG: round(per100g.proteinG * f),
    carbsG: round(per100g.carbsG * f),
    fatG: round(per100g.fatG * f),
  };
}

export const EMPTY_MACROS: Macros = {
  kcal: 0,
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
};

export function sumMacros(entries: readonly Macros[]): Macros {
  const total = entries.reduce<Macros>(
    (acc, m) => ({
      kcal: acc.kcal + m.kcal,
      proteinG: acc.proteinG + m.proteinG,
      carbsG: acc.carbsG + m.carbsG,
      fatG: acc.fatG + m.fatG,
    }),
    EMPTY_MACROS,
  );
  return {
    kcal: round(total.kcal, 0),
    proteinG: round(total.proteinG),
    carbsG: round(total.carbsG),
    fatG: round(total.fatG),
  };
}

/** Calories implied by the macros, per the Atwater factors. */
export function kcalFromMacros(
  m: Pick<Macros, 'proteinG' | 'carbsG' | 'fatG'>,
): number {
  return (
    m.proteinG * KCAL_PER_G.protein +
    m.carbsG * KCAL_PER_G.carbs +
    m.fatG * KCAL_PER_G.fat
  );
}

/**
 * Do the macros roughly account for the stated calories? Labels legitimately
 * disagree by a few percent (fibre, polyols, rounding), so the tolerance is
 * wide -- this is here to catch a misread digit or a mismatched column, not to
 * audit the manufacturer.
 */
export function atwaterAgrees(m: Macros, tolerance = 0.2): boolean {
  if (m.kcal <= 0) return false;
  const implied = kcalFromMacros(m);
  return Math.abs(implied - m.kcal) / m.kcal <= tolerance;
}

/** Mifflin-St Jeor resting energy expenditure, in kcal/day. */
export function bmr(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
}): number {
  const base = 10 * input.weightKg + 6.25 * input.heightCm - 5 * input.ageYears;
  return round(base + (input.sex === 'male' ? 5 : -161), 0);
}

export function tdee(input: {
  sex: Sex;
  weightKg: number;
  heightCm: number;
  ageYears: number;
  activityLevel: ActivityLevel;
}): number {
  return round(bmr(input) * ACTIVITY_LEVELS[input.activityLevel], 0);
}

export function ageFrom(birthDate: string, on: Date = new Date()): number {
  const b = new Date(birthDate);
  let age = on.getUTCFullYear() - b.getUTCFullYear();
  const monthDiff = on.getUTCMonth() - b.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && on.getUTCDate() < b.getUTCDate())) age -= 1;
  return age;
}

/**
 * Energy in a kilogram of body fat. The textbook 7700 kcal figure: real weight
 * change is messier than the arithmetic suggests, which is why the rate below
 * is capped at what is generally considered sustainable.
 */
export const KCAL_PER_KG_FAT = 7700;

export const WEIGHT_GOALS = ['lose', 'maintain', 'gain'] as const;
export type WeightGoal = (typeof WEIGHT_GOALS)[number];

/** Beyond this, weight change comes increasingly from muscle rather than fat. */
export const MAX_KG_PER_WEEK = 1;

export interface CalorieTargetInput {
  /** Maintenance, from Mifflin-St Jeor times an activity factor. */
  tdee: number;
  goal: WeightGoal;
  /** Rate of change; ignored when maintaining. */
  kgPerWeek?: number;
  /** Resting expenditure, used as a floor. */
  bmr?: number;
}

/**
 * Daily calories for a goal.
 *
 * Floored at resting expenditure: eating below what you burn at rest is not a
 * faster route to the same place, and an app that quietly suggests it is
 * giving bad advice. A requested rate that would breach the floor produces the
 * floor instead, and `limited` says so rather than pretending the number was
 * what you asked for.
 */
export function targetCalories(input: CalorieTargetInput): {
  calories: number;
  dailyDelta: number;
  limited: boolean;
} {
  const rate = Math.min(Math.abs(input.kgPerWeek ?? 0), MAX_KG_PER_WEEK);
  const perDay = Math.round((rate * KCAL_PER_KG_FAT) / 7);

  const delta =
    input.goal === 'maintain' ? 0 : input.goal === 'lose' ? -perDay : perDay;

  const raw = input.tdee + delta;
  const floor = input.bmr ?? 0;
  const limited = input.goal === 'lose' && raw < floor;

  return {
    calories: Math.round(limited ? floor : raw),
    dailyDelta: delta,
    limited,
  };
}

/**
 * Split a calorie target into grams. Protein is anchored to bodyweight rather
 * than to a percentage, because that is how the target is actually reasoned
 * about; fat takes a share of the remainder and carbs absorb the rest.
 */
export function suggestMacroSplit(opts: {
  calories: number;
  weightKg: number;
  proteinGPerKg?: number;
  fatPercent?: number;
  /** In a deficit, protein is raised: it is what protects muscle while the
   *  calories it is competing with are scarce. */
  goal?: WeightGoal;
}): Pick<Macros, 'proteinG' | 'carbsG' | 'fatG'> {
  const perKg = opts.proteinGPerKg ?? (opts.goal === 'lose' ? 2.2 : 1.8);
  const proteinG = round(opts.weightKg * perKg, 0);
  const fatG = round((opts.calories * (opts.fatPercent ?? 0.28)) / KCAL_PER_G.fat, 0);
  const remaining =
    opts.calories - proteinG * KCAL_PER_G.protein - fatG * KCAL_PER_G.fat;
  return {
    proteinG,
    fatG,
    carbsG: round(Math.max(0, remaining) / KCAL_PER_G.carbs, 0),
  };
}

/** Local calendar date as YYYY-MM-DD. Days are user-local, never UTC. */
export function toDateKey(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateKey(dt);
}

/** The meal you are most likely reaching for, by the clock. */
export function guessMeal(now = new Date()): Meal {
  const h = now.getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}
