import {
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

export const mealEnum = pgEnum('meal', ['breakfast', 'lunch', 'dinner', 'snack']);
/**
 * 'slv' is Livsmedelsverket, the Swedish Food Agency's food composition
 * database: generic Swedish staples that have no barcode and that Open Food
 * Facts covers badly. Seeded locally rather than queried live, since its API
 * offers neither bulk fetch nor name search.
 */
export const foodSourceEnum = pgEnum('food_source', ['off', 'custom', 'slv']);
export const sexEnum = pgEnum('sex', ['male', 'female']);
export const activityLevelEnum = pgEnum('activity_level', [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
]);

/**
 * Emails are stored already lowercased by the auth layer, so a plain unique
 * index is enough and we avoid depending on the citext extension.
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  sex: sexEnum('sex'),
  birthDate: date('birth_date'),
  heightCm: real('height_cm'),
  activityLevel: activityLevelEnum('activity_level'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Registration is gated on one of these. Single-use, optionally expiring. */
export const invites = pgTable('invites', {
  code: text('code').primaryKey(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  usedBy: uuid('used_by').references(() => users.id, { onDelete: 'set null' }),
  usedAt: timestamp('used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Opaque session tokens rather than JWTs: for a handful of users this is less
 * machinery than refresh-token rotation, and logging out actually logs you out.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/**
 * Append-only: changing your target in March must not retroactively rewrite
 * how January looked. The row in force on a given day is the latest one whose
 * effective_from is on or before it.
 */
export const goals = pgTable(
  'goals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    effectiveFrom: date('effective_from').notNull(),
    calories: integer('calories').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('goals_user_date_uq').on(t.userId, t.effectiveFrom)],
);

/**
 * Nutrition is stored per 100g for every food regardless of source, so two
 * foods are always directly comparable and scaling is one multiplication.
 */
export const foods = pgTable(
  'foods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    source: foodSourceEnum('source').notNull(),
    barcode: text('barcode'),
    name: text('name').notNull(),
    brand: text('brand'),
    kcal100g: real('kcal_100g').notNull(),
    protein100g: real('protein_100g').notNull(),
    carbs100g: real('carbs_100g').notNull(),
    fat100g: real('fat_100g').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** When this was last pulled from Open Food Facts; null for custom foods. */
    offFetchedAt: timestamp('off_fetched_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('foods_source_barcode_uq').on(t.source, t.barcode),
    index('foods_name_idx').on(t.name),
  ],
);

/** Display shortcuts ("1 slice = 28 g"); never the unit of storage. */
export const foodServings = pgTable(
  'food_servings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    grams: real('grams').notNull(),
  },
  (t) => [index('food_servings_food_idx').on(t.foodId)],
);

/**
 * Macros are snapshotted at log time. If an Open Food Facts product is later
 * corrected, or you fix a typo in a custom food, history stays what it was --
 * this is the single most important decision in the schema.
 */
export const logEntries = pgTable(
  'log_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'restrict' }),
    loggedOn: date('logged_on').notNull(),
    meal: mealEnum('meal').notNull(),
    grams: real('grams').notNull(),
    kcal: real('kcal').notNull(),
    proteinG: real('protein_g').notNull(),
    carbsG: real('carbs_g').notNull(),
    fatG: real('fat_g').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('log_entries_user_date_idx').on(t.userId, t.loggedOn),
    index('log_entries_user_food_idx').on(t.userId, t.foodId),
  ],
);

/**
 * Long-lived tokens for agents acting on your behalf -- a chat assistant
 * logging a meal, a shortcut, a script.
 *
 * Only the SHA-256 of the token is stored. Unlike a password these are
 * high-entropy random strings, so a fast hash is the right choice: there is
 * nothing to brute-force, and the lookup happens on every request.
 */
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Shown in settings so you can tell which agent a token belongs to. */
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('api_tokens_user_idx').on(t.userId)],
);

/**
 * Foods you have touched without necessarily eating them: scanned a barcode
 * for, or created by hand. Logging is a strong signal but a narrow one -- a
 * food you looked up two minutes ago is exactly what you are about to reach
 * for, and before this it was nowhere to be found.
 *
 * One row per user and food, rewritten on each interaction rather than
 * appended, since only the most recent contact matters.
 */
export const foodViews = pgTable(
  'food_views',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    foodId: uuid('food_id')
      .notNull()
      .references(() => foods.id, { onDelete: 'cascade' }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.foodId] }),
    index('food_views_user_time_idx').on(t.userId, t.viewedAt),
  ],
);

export const weights = pgTable(
  'weights',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    measuredOn: date('measured_on').notNull(),
    weightKg: real('weight_kg').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('weights_user_date_uq').on(t.userId, t.measuredOn)],
);
