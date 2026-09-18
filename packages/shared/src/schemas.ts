import { z } from 'zod';
import { ACTIVITY_LEVEL_KEYS, MEALS, SEXES } from './nutrition.ts';

/** YYYY-MM-DD, the form every date crosses the wire in. */
export const dateKey = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const mealSchema = z.enum(MEALS);
export const sexSchema = z.enum(SEXES);
export const activityLevelSchema = z.enum(ACTIVITY_LEVEL_KEYS);

/* ---------------------------------------------------------------- auth --- */

export const registerBody = z.object({
  email: z.email().max(254),
  password: z.string().min(10, 'use at least 10 characters').max(200),
  displayName: z.string().min(1).max(80),
  inviteCode: z.string().min(1).max(100),
});

export const loginBody = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

export const userResponse = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
});

/* ------------------------------------------------------------- profile --- */

export const profileBody = z.object({
  sex: sexSchema.nullable(),
  birthDate: dateKey.nullable(),
  heightCm: z.number().min(50).max(260).nullable(),
  activityLevel: activityLevelSchema.nullable(),
});

export const goalBody = z.object({
  calories: z.number().int().min(500).max(10000),
  proteinG: z.number().min(0).max(600),
  carbsG: z.number().min(0).max(1500),
  fatG: z.number().min(0).max(600),
  effectiveFrom: dateKey.optional(),
});

/* --------------------------------------------------------------- foods --- */

/**
 * Nutrition is always stored and exchanged per 100g. Serving sizes are a
 * display convenience layered on top, never the unit of storage -- that way
 * two foods are always directly comparable.
 */
export const macrosPer100g = z.object({
  kcal100g: z.number().min(0).max(900),
  protein100g: z.number().min(0).max(100),
  carbs100g: z.number().min(0).max(100),
  fat100g: z.number().min(0).max(100),
});

export const servingInput = z.object({
  label: z.string().min(1).max(60),
  grams: z.number().min(0.1).max(5000),
});

export const createFoodBody = macrosPer100g.extend({
  name: z.string().min(1).max(200),
  brand: z.string().max(120).nullable().optional(),
  barcode: z.string().regex(/^\d{6,14}$/).nullable().optional(),
  servings: z.array(servingInput).max(10).optional(),
});

export const updateFoodBody = createFoodBody.partial();

export const foodResponse = macrosPer100g.extend({
  id: z.string(),
  source: z.enum(['off', 'custom']),
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  servings: z.array(servingInput.extend({ id: z.string() })),
});

export const foodSearchQuery = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/* ----------------------------------------------------------------- log --- */

export const createLogBody = z.object({
  foodId: z.uuid(),
  grams: z.number().min(0.1).max(5000),
  meal: mealSchema,
  loggedOn: dateKey,
});

export const updateLogBody = z.object({
  grams: z.number().min(0.1).max(5000).optional(),
  meal: mealSchema.optional(),
});

export const macrosResponse = z.object({
  kcal: z.number(),
  proteinG: z.number(),
  carbsG: z.number(),
  fatG: z.number(),
});

export const logEntryResponse = macrosResponse.extend({
  id: z.string(),
  meal: mealSchema,
  grams: z.number(),
  loggedOn: dateKey,
  food: z.object({
    id: z.string(),
    name: z.string(),
    brand: z.string().nullable(),
  }),
});

export const dayResponse = z.object({
  date: dateKey,
  totals: macrosResponse,
  goal: z
    .object({
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
    })
    .nullable(),
  meals: z.record(mealSchema, z.array(logEntryResponse)),
});

export const rangeQuery = z.object({ from: dateKey, to: dateKey });

/* ------------------------------------------------------------- weights --- */

export const createWeightBody = z.object({
  measuredOn: dateKey,
  weightKg: z.number().min(20).max(400),
});

/* ----------------------------------------------------------------- ocr --- */

/**
 * Every OCR field carries its own confidence, because the useful question is
 * never "did the scan work" but "which of these four numbers should I check".
 */
export const ocrField = z.object({
  value: z.number().nullable(),
  confidence: z.number().min(0).max(1),
  /** The label line this came from, so the UI can show its provenance. */
  sourceLine: z.string().nullable(),
});

export const ocrResponse = z.object({
  kcal100g: ocrField,
  protein100g: ocrField,
  carbs100g: ocrField,
  fat100g: ocrField,
  /** Detected serving size in grams, if the label declared one. */
  servingG: ocrField,
  /** True when the macros roughly account for the stated calories. */
  atwaterOk: z.boolean(),
  /** Which column the numbers were taken from. */
  column: z.enum(['per_100g', 'per_serving', 'unknown']),
  detectedLanguage: z.enum(['sv', 'en', 'unknown']),
  rawText: z.string(),
});

/* --------------------------------------------------------------- types --- */

export type RegisterBody = z.infer<typeof registerBody>;
export type LoginBody = z.infer<typeof loginBody>;
export type UserResponse = z.infer<typeof userResponse>;
export type ProfileBody = z.infer<typeof profileBody>;
export type GoalBody = z.infer<typeof goalBody>;
export type CreateFoodBody = z.infer<typeof createFoodBody>;
export type UpdateFoodBody = z.infer<typeof updateFoodBody>;
export type FoodResponse = z.infer<typeof foodResponse>;
export type CreateLogBody = z.infer<typeof createLogBody>;
export type UpdateLogBody = z.infer<typeof updateLogBody>;
export type LogEntryResponse = z.infer<typeof logEntryResponse>;
export type DayResponse = z.infer<typeof dayResponse>;
export type CreateWeightBody = z.infer<typeof createWeightBody>;
export type OcrResponse = z.infer<typeof ocrResponse>;
export type OcrField = z.infer<typeof ocrField>;
