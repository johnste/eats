import { atwaterAgrees, kjToKcal, round, type Macros } from '@eats/shared';
import {
  ENGLISH_MARKERS,
  NUTRIENTS,
  PER_100G_PATTERNS,
  PER_SERVING_PATTERNS,
  SUB_LINE_MARKERS,
  SWEDISH_MARKERS,
  type NutrientKey,
} from './labels.ts';

export type Column = 'per_100g' | 'per_serving' | 'unknown';
export type Language = 'sv' | 'en' | 'unknown';

export interface Field {
  value: number | null;
  confidence: number;
  sourceLine: string | null;
}

export interface ParseResult {
  kcal100g: Field;
  protein100g: Field;
  carbs100g: Field;
  fat100g: Field;
  servingG: Field;
  atwaterOk: boolean;
  column: Column;
  detectedLanguage: Language;
  rawText: string;
}

const EMPTY: Field = { value: null, confidence: 0, sourceLine: null };

/* ------------------------------------------------------- normalisation --- */

/**
 * Characters Tesseract routinely swaps inside numbers. Applied only to tokens
 * that are already almost entirely digits, so words are never mangled.
 */
const DIGIT_REPAIRS: Record<string, string> = {
  O: '0', o: '0', Q: '0', D: '0',
  l: '1', I: '1', i: '1', '|': '1',
  S: '5', s: '5',
  B: '8',
  Z: '2', z: '2',
  G: '6',
};

function repairNumeric(token: string): string {
  if (!/\d/.test(token)) return token;
  if (!/^[0-9OoQDlIi|SsBZzG.,\s ]+$/.test(token)) return token;
  return token.replace(/[OoQDlIi|SsBZzG]/g, (c) => DIGIT_REPAIRS[c] ?? c);
}

export function normalizeLine(line: string): string {
  return line
    .replace(/[  ]/g, ' ')
    .split(/(\s+)/)
    .map((part) => (/^\s+$/.test(part) ? ' ' : repairNumeric(part)))
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/* ------------------------------------------------------------- numbers --- */

export interface NumberToken {
  value: number;
  unit: 'g' | 'mg' | 'kcal' | 'kj' | 'ml' | '%' | null;
}

/**
 * Matches `12`, `12,5`, `1 234` (Swedish thousands separator) with an optional
 * trailing unit. The thousands-group branch comes first so `1 234` is one
 * number rather than two.
 */
const NUMBER_RE =
  /(\d{1,3}(?:[ ]\d{3})+|\d+(?:[.,]\d+)?)\s*(kcal|kj|mg|ml|g|%)?/gi;

export function extractNumbers(line: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of line.matchAll(NUMBER_RE)) {
    const digits = (m[1] ?? '').replace(/ /g, '').replace(',', '.');
    const value = Number.parseFloat(digits);
    if (!Number.isFinite(value)) continue;
    const unit = (m[2]?.toLowerCase() ?? null) as NumberToken['unit'];
    out.push({ value, unit });
  }
  return out;
}

/* ------------------------------------------------------ fuzzy matching --- */

/** Levenshtein distance, capped -- we only care about "within a typo or two". */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (cur[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length] ?? max + 1;
}

/** The words before the first digit -- the label part of a table row. */
export function labelPart(line: string): string {
  const idx = line.search(/\d/);
  return (idx === -1 ? line : line.slice(0, idx)).replace(/[^a-zåäöé\s]/g, ' ').trim();
}

export interface Match {
  key: NutrientKey;
  isSub: boolean;
  quality: 'exact' | 'fuzzy';
}

export function matchNutrient(line: string): Match | null {
  const label = labelPart(line);
  if (!label) return null;

  const markedSub = SUB_LINE_MARKERS.some((re) => re.test(line));

  for (const spec of NUTRIENTS) {
    if (spec.patterns.some((re) => re.test(line))) {
      return { key: spec.key, isSub: spec.isSub || markedSub, quality: 'exact' };
    }
  }

  // Nothing matched cleanly; Tesseract may have mangled a character. Compare
  // each word of the label against every known term.
  const words = label.split(/\s+/).filter((w) => w.length >= 4);
  for (const spec of NUTRIENTS) {
    for (const term of spec.terms) {
      const target = term.split(/\s+/).at(-1) ?? term;
      for (const w of words) {
        const tolerance = target.length >= 8 ? 2 : 1;
        if (editDistance(w, target, tolerance) <= tolerance) {
          return { key: spec.key, isSub: spec.isSub || markedSub, quality: 'fuzzy' };
        }
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------- layout --- */

export interface Layout {
  column: Column;
  /** Which number on a data row to take. */
  index: number;
  servingG: number | null;
  headerLine: string | null;
}

/**
 * Per 100 g is printed first by law, so index 0 is the default. We only move
 * off it when a header explicitly puts the portion column first.
 */
export function detectLayout(lines: string[]): Layout {
  for (const line of lines) {
    const per100 = PER_100G_PATTERNS.map((re) => line.search(re)).filter((i) => i >= 0);
    const perServ = PER_SERVING_PATTERNS.map((re) => line.search(re)).filter((i) => i >= 0);
    if (per100.length === 0 && perServ.length === 0) continue;

    const servingG = extractServingGrams(line);

    if (per100.length > 0 && perServ.length > 0) {
      const p100 = Math.min(...per100);
      const pServ = Math.min(...perServ);
      return {
        column: 'per_100g',
        index: p100 <= pServ ? 0 : 1,
        servingG,
        headerLine: line,
      };
    }
    if (per100.length > 0) {
      return { column: 'per_100g', index: 0, servingG, headerLine: line };
    }
    return { column: 'per_serving', index: 0, servingG, headerLine: line };
  }
  return { column: 'unknown', index: 0, servingG: null, headerLine: null };
}

/** "per portion (30 g)" / "serving size 30 g" -> 30 */
export function extractServingGrams(line: string): number | null {
  const m = line.match(
    /(?:portion|serving|portionsstorlek)[^0-9]{0,20}(\d+(?:[.,]\d+)?)\s*(g|ml)/,
  );
  if (!m?.[1]) return null;
  const v = Number.parseFloat(m[1].replace(',', '.'));
  return Number.isFinite(v) ? v : null;
}

/* --------------------------------------------------------------- parse --- */

function pickNumber(nums: NumberToken[], index: number): NumberToken | null {
  if (nums.length === 0) return null;
  return nums[Math.min(index, nums.length - 1)] ?? null;
}

/** Energy rows carry two figures; the kcal one is what we want. */
function energyKcal(nums: NumberToken[], index: number): number | null {
  const kcal = nums.filter((n) => n.unit === 'kcal');
  if (kcal.length > 0) return (kcal[Math.min(index, kcal.length - 1)] ?? kcal[0])?.value ?? null;

  const kj = nums.filter((n) => n.unit === 'kj');
  if (kj.length > 0) {
    const chosen = kj[Math.min(index, kj.length - 1)] ?? kj[0];
    return chosen ? round(kjToKcal(chosen.value), 0) : null;
  }
  // Unitless: on a two-number energy row the kJ figure is printed first, so the
  // second number is the kcal one.
  if (nums.length >= 2) return nums[1]?.value ?? null;
  return nums[0]?.value ?? null;
}

export function detectLanguage(text: string): Language {
  const sv = SWEDISH_MARKERS.filter((m) => text.includes(m)).length;
  const en = ENGLISH_MARKERS.filter((m) => text.includes(m)).length;
  if (sv === 0 && en === 0) return 'unknown';
  if (sv === en) return 'unknown';
  return sv > en ? 'sv' : 'en';
}

const CONFIDENCE = { exact: 0.95, fuzzy: 0.7 } as const;

/**
 * Turn recognised text into per-100g macros. Pure: the same text always gives
 * the same answer, which is what makes this testable from fixtures.
 */
export function parseNutritionText(rawText: string): ParseResult {
  const lines = rawText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter((l) => l.length > 0);

  const layout = detectLayout(lines);
  const joined = lines.join('\n');

  const found = new Map<NutrientKey, Field>();

  for (const line of lines) {
    if (line === layout.headerLine) continue;
    const match = matchNutrient(line);
    if (!match) continue;

    // The rule that matters: a sub-nutrient row never fills its parent's slot.
    const key = match.key;
    if (found.has(key)) continue;

    const nums = extractNumbers(line);
    if (nums.length === 0) continue;

    const value =
      key === 'energy'
        ? energyKcal(nums, layout.index)
        : (pickNumber(nums, layout.index)?.value ?? null);
    if (value === null) continue;

    found.set(key, {
      value,
      confidence: CONFIDENCE[match.quality],
      sourceLine: line,
    });
  }

  const field = (k: NutrientKey): Field => found.get(k) ?? EMPTY;
  const energy = field('energy');
  const protein = field('protein');
  const carbs = field('carbs');
  const fat = field('fat');

  const macros: Macros = {
    kcal: energy.value ?? 0,
    proteinG: protein.value ?? 0,
    carbsG: carbs.value ?? 0,
    fatG: fat.value ?? 0,
  };
  const complete =
    energy.value !== null &&
    protein.value !== null &&
    carbs.value !== null &&
    fat.value !== null;
  const atwaterOk = complete && atwaterAgrees(macros);

  // A failed cross-check means one of these four numbers is wrong, but not
  // which. Lower all of them so the review form flags the whole set.
  const penalty = complete && !atwaterOk ? 0.5 : 1;
  const scale = (f: Field): Field =>
    f.value === null ? f : { ...f, confidence: round(f.confidence * penalty, 2) };

  return {
    kcal100g: scale(energy),
    protein100g: scale(protein),
    carbs100g: scale(carbs),
    fat100g: scale(fat),
    servingG:
      layout.servingG === null
        ? EMPTY
        : { value: layout.servingG, confidence: 0.9, sourceLine: layout.headerLine },
    atwaterOk,
    column: layout.column,
    detectedLanguage: detectLanguage(joined),
    rawText,
  };
}
