/**
 * EU Regulation 1169/2011 Annex XV fixes what a nutrition declaration contains,
 * in what order, and in which units. That is why this feature can be a lookup
 * table instead of a language model: a Swedish label and an English one are the
 * same table with different words in it.
 */

export type NutrientKey =
  | 'energy'
  | 'fat'
  | 'saturates'
  | 'carbs'
  | 'sugars'
  | 'fibre'
  | 'protein'
  | 'salt';

/** The four the app actually stores. The rest are parsed only to be excluded. */
export const STORED_NUTRIENTS = ['energy', 'fat', 'carbs', 'protein'] as const;

interface NutrientSpec {
  key: NutrientKey;
  /** Sub-nutrients must never overwrite their parent. */
  isSub: boolean;
  patterns: RegExp[];
  /** Words to fuzzy-match against when no pattern matches cleanly. */
  terms: string[];
}

/**
 * Order matters. "varav mättat fett" contains "fett", so saturates has to be
 * tested before fat, and sugars before carbohydrate -- otherwise the sub-line
 * captures its parent's slot and you silently log sugar as your carb total.
 */
export const NUTRIENTS: readonly NutrientSpec[] = [
  {
    key: 'saturates',
    isSub: true,
    patterns: [/m[äaà]ttat?\s*fett/, /m[äa]ttade\s*fettsyror/, /saturate/, /mattat/],
    terms: ['mättat fett', 'mättade fettsyror', 'saturates', 'saturated fat'],
  },
  {
    key: 'sugars',
    isSub: true,
    patterns: [/sockerarter/, /\bsocker\b/, /\bsugars?\b/],
    terms: ['sockerarter', 'socker', 'sugars'],
  },
  {
    key: 'fibre',
    isSub: false,
    patterns: [/kostfiber/, /\bfibrer?\b/, /\bfibre?\b/, /dietary\s*fib/],
    terms: ['fiber', 'kostfiber', 'fibre', 'dietary fibre'],
  },
  {
    key: 'protein',
    isSub: false,
    patterns: [/\bprotein/],
    terms: ['protein', 'proteiner'],
  },
  {
    key: 'salt',
    isSub: false,
    patterns: [/\bsalt\b/, /\bnatrium\b/, /\bsodium\b/],
    terms: ['salt', 'natrium', 'sodium'],
  },
  {
    key: 'fat',
    isSub: false,
    patterns: [/\bfett\b/, /\bfat\b/, /totalt\s*fett/, /total\s*fat/],
    terms: ['fett', 'fat', 'totalt fett'],
  },
  {
    key: 'carbs',
    isSub: false,
    patterns: [/kolhydrat/, /carbohydrat/, /\bcarbs?\b/],
    terms: ['kolhydrat', 'kolhydrater', 'carbohydrate', 'carbohydrates'],
  },
  {
    key: 'energy',
    isSub: false,
    patterns: [/\benergi?\b/, /\benergy\b/, /energiv[äa]rde/],
    terms: ['energi', 'energy', 'energivärde'],
  },
];

/** A line beginning with one of these is a sub-nutrient regardless of wording. */
export const SUB_LINE_MARKERS = [/^varav\b/, /^d[äa]rav\b/, /^of\s+which\b/, /\bvarav\b/, /\bof\s+which\b/];

export const SWEDISH_MARKERS = [
  'energi',
  'fett',
  'kolhydrat',
  'varav',
  'sockerarter',
  'mättat',
  'näringsvärde',
  'portion',
  'salt',
  'kostfiber',
];

export const ENGLISH_MARKERS = [
  'energy',
  'fat',
  'carbohydrate',
  'of which',
  'sugars',
  'saturates',
  'nutrition',
  'serving',
  'protein',
  'fibre',
];

/** Header phrases that identify which column is which. */
export const PER_100G_PATTERNS = [/per\s*100\s*(g|ml)/, /\/\s*100\s*(g|ml)/, /100\s*(g|ml)/];
export const PER_SERVING_PATTERNS = [
  /per\s*portion/,
  /per\s*serving/,
  /portionsstorlek/,
  /serving\s*size/,
  /per\s*port\b/,
];
