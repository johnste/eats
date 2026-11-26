import { z } from 'zod';
import { ACTIVITY_LEVEL_KEYS, MEALS, SEXES } from './nutrition.ts';

/** YYYY-MM-DD, the form every date crosses the wire in. */
export const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');

export const mealSchema = z.enum(MEALS);
export const sexSchema = z.enum(SEXES);
export const activityLevelSchema = z.enum(ACTIVITY_LEVEL_KEYS);

/** Every non-2xx response in the API has this shape. */
export const errorResponse = z.object({ error: z.string() });

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
  targetWeightKg: z.number().min(20).max(400).nullable(),
  /** Include Open Food Facts in search. */
  useOff: z.boolean(),
  /** Look a scanned barcode up in Open Food Facts. */
  useOffBarcode: z.boolean(),
  /** Show the seeded Livsmedelsverket foods in search results. */
  useSlv: z.boolean(),
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
  barcode: z
    .string()
    .regex(/^\d{6,14}$/)
    .nullable()
    .optional(),
  servings: z.array(servingInput).max(10).optional(),
  /** The values are a guess, not read off a label. */
  estimated: z.boolean().optional(),
});

export const updateFoodBody = createFoodBody.partial();

/** 'slv' is Livsmedelsverket, the Swedish Food Agency's food database. */
export const foodSource = z.enum(['off', 'custom', 'slv']);

export const foodResponse = macrosPer100g.extend({
  id: z.string(),
  source: foodSource,
  name: z.string(),
  brand: z.string().nullable(),
  barcode: z.string().nullable(),
  /** The values are a guess, not read off a label; shown as a mark. */
  estimated: z.boolean(),
  servings: z.array(servingInput.extend({ id: z.string() })),
  /**
   * How much of this you usually log: the median of your last few entries.
   * Only on lists meant for picking (recents, search, companions), and null
   * for a food you have never logged.
   */
  usualGrams: z.number().nullable().optional(),
});

/** One of your own foods, with how much it is used, for managing them. */
export const myFoodResponse = foodResponse.extend({
  /** How many entries on your log point at it; deletable only at zero. */
  entries: z.number(),
  lastLoggedOn: dateKey.nullable(),
});

/**
 * A search hit from Open Food Facts. The search index carries names and
 * barcodes but no nutriments, so a candidate is not yet a food -- picking one
 * resolves its macros through the barcode endpoint.
 */
export const offCandidate = z.object({
  barcode: z.string(),
  name: z.string(),
  brand: z.string().nullable(),
});

export const foodSearchResponse = z.object({
  /** Your own foods and anything already cached locally. */
  local: z.array(foodResponse),
  off: z.array(offCandidate),
  /** True when Open Food Facts could not be reached; local results still stand. */
  offUnavailable: z.boolean(),
});

/**
 * Looking up a barcode has three outcomes, and the client routes on them:
 * a usable food, a product whose nutrition data is unusable (whose name still
 * prefills manual entry), or nothing at all.
 */
export const barcodeLookupResponse = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), food: foodResponse }),
  z.object({
    status: z.literal('incomplete'),
    prefill: z.object({
      barcode: z.string(),
      name: z.string(),
      brand: z.string().nullable(),
      servingG: z.number().nullable(),
      missing: z.array(z.string()),
    }),
  }),
]);

/** Foods you have eaten in the same meal as these, most often first. */
export const companionsQuery = z.object({
  ids: z
    .string()
    .transform((v) => v.split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(20)),
});

/** What to suggest for one meal on one day. */
export const suggestQuery = z.object({
  meal: mealSchema,
  date: dateKey,
  /**
   * Foods picked for this meal but not logged yet, which count as already
   * in it: what you have put on the plate so far.
   */
  with: z
    .string()
    .optional()
    .transform((v) => (v ?? '').split(',').filter(Boolean))
    .pipe(z.array(z.uuid()).max(20)),
});

/**
 * Foods worth offering before you type anything, with the history behind
 * each one. The counts come back raw rather than as a score, because the
 * ranking also weighs the weights you have typed and still have to match,
 * and those change with every keystroke -- the client ranks (rankSuggestions).
 */
export const suggestResponse = z.object({
  /** Days in the window that had this meal at all. */
  mealDays: z.number(),
  /** Already in this meal on this day: what the rest should go with. */
  context: z.array(z.object({ id: z.string(), name: z.string() })),
  /** Past meals that had any of the context foods in them. */
  contextMeals: z.number(),
  foods: z.array(
    foodResponse.extend({
      /** Days it was in this meal. */
      meals: z.number(),
      /** Days it was the first thing logged to this meal. */
      first: z.number(),
      /** Past meals it shared with any of the context foods. */
      together: z.number(),
    }),
  ),
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

/** Several entries at once, all or nothing -- one weighed sandwich. */
export const createLogBatchBody = z.object({
  entries: z.array(createLogBody).min(1).max(20),
});

export const updateLogBody = z.object({
  grams: z.number().min(0.1).max(5000).optional(),
  meal: mealSchema.optional(),
  /** Changing this moves the entry to another day. */
  loggedOn: dateKey.optional(),
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
    estimated: z.boolean(),
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

export const duplicateGroupResponse = z.object({
  name: z.string(),
  foods: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      brand: z.string().nullable(),
      source: foodSource,
      kcal100g: z.number(),
      estimated: z.boolean(),
      entries: z.number(),
      removable: z.boolean(),
    }),
  ),
});

export const mergeFoodsBody = z.object({
  /** The food that disappears. Must be one of yours. */
  sourceId: z.uuid(),
  /** The food it folds into. */
  targetId: z.uuid(),
});

export const rangeQuery = z.object({ from: dateKey, to: dateKey });

/**
 * One row per day across a range, including days with nothing on them.
 *
 * Macros are null rather than zero for a day that was never logged: a blank
 * day is an absence of data, and averaging it as a zero would quietly drag
 * every number down. The goal is the one that was in force on that day --
 * goals are append-only precisely so history keeps the target it was
 * actually judged against.
 */
export const daySummaryResponse = z.object({
  date: dateKey,
  kcal: z.number().nullable(),
  proteinG: z.number().nullable(),
  carbsG: z.number().nullable(),
  fatG: z.number().nullable(),
  goal: z
    .object({
      calories: z.number(),
      proteinG: z.number(),
      carbsG: z.number(),
      fatG: z.number(),
    })
    .nullable(),
});

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
export type MyFoodResponse = z.infer<typeof myFoodResponse>;
export type CreateLogBody = z.infer<typeof createLogBody>;
export type CreateLogBatchBody = z.infer<typeof createLogBatchBody>;
export type UpdateLogBody = z.infer<typeof updateLogBody>;
export type LogEntryResponse = z.infer<typeof logEntryResponse>;
export type DayResponse = z.infer<typeof dayResponse>;
export type DaySummaryResponse = z.infer<typeof daySummaryResponse>;
export type DuplicateGroupResponse = z.infer<typeof duplicateGroupResponse>;
export type CreateWeightBody = z.infer<typeof createWeightBody>;
export type OcrResponse = z.infer<typeof ocrResponse>;
export type OcrField = z.infer<typeof ocrField>;
export type ErrorResponse = z.infer<typeof errorResponse>;
export type OffCandidate = z.infer<typeof offCandidate>;
export type FoodSearchResponse = z.infer<typeof foodSearchResponse>;
export type BarcodeLookupResponse = z.infer<typeof barcodeLookupResponse>;
export type SuggestResponse = z.infer<typeof suggestResponse>;
export type SuggestedFood = SuggestResponse['foods'][number];
