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
/** Applied to a value only kept because the Atwater check preferred it. */
const REPAIRED_CONFIDENCE = 0.6;

/**
 * Tesseract routinely welds a value's unit onto its number: "6,2 g" comes back
 * as "6,29" and "11 g" as "119". That is worse than an outright failure,
 * because the result still looks like a number.
 *
 * It takes two forms: the unit replaces itself with a digit ("6,2 g" ->
 * "6,29"), or it duplicates itself ("11 g" -> "119g"), so the presence of a
 * unit is no guarantee the number is clean.
 *
 * It cannot be fixed by resolution alone -- it comes and goes with layout --
 * and it cannot be repaired blindly, because 6.29 and 119 are values a label
 * could genuinely carry. So this only ever proposes an alternative reading;
 * which one is correct gets settled below, by arithmetic.
 */
function unitWeldedAlternative(token: NumberToken): number | null {
  const text = String(token.value);
  if (!text.endsWith('9')) return null;
  const stripped = text.slice(0, -1).replace(/[.,]$/, '');
  if (stripped === '') return null;
  const value = Number.parseFloat(stripped);
  return Number.isFinite(value) ? value : null;
}

const decimals = (n: number): number => (String(n).split('.')[1] ?? '').length;

/**
 * Reg. 1169/2011 Annex XIV fixes how declared values are rounded: at or above
 * 10 g to the nearest gram, below that to one decimal place. So a macro with
 * two decimals is not a number any label carries, and when dropping a welded
 * unit turns 6.29 into 6.2, that is decisive on its own.
 *
 * This matters because arithmetic cannot settle this case -- 6.2 and 6.29 both
 * satisfy the Atwater check comfortably. Only the rounding rule separates them.
 */
function preferByRounding(primary: number, alternative: number | null): boolean {
  return alternative !== null && decimals(primary) > 1 && decimals(alternative) <= 1;
}

/** Every combination of primary/alternative readings, primaries first. */
function* readings<K extends string>(
  options: ReadonlyArray<readonly [K, number, number | null]>,
): Generator<Map<K, { value: number; repaired: boolean }>> {
  const count = 2 ** options.length;
  // Ordered so that the all-primary reading is tried first, then those with
  // progressively more repairs.
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => popcount(a) - popcount(b),
  );
  for (const mask of order) {
    const out = new Map<K, { value: number; repaired: boolean }>();
    let usable = true;
    for (const [i, entry] of options.entries()) {
      const [key, primary, alternative] = entry;
      const useAlt = (mask & (1 << i)) !== 0;
      if (useAlt && alternative === null) { usable = false; break; }
      out.set(key, {
        value: useAlt ? (alternative as number) : primary,
        repaired: useAlt,
      });
    }
    if (usable) yield out;
  }
}

const popcount = (n: number): number => {
  let c = 0;
  for (let v = n; v > 0; v >>= 1) c += v & 1;
  return c;
};

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
  /** Second-guess readings for values whose unit went missing. */
  const alternatives = new Map<NutrientKey, number | null>();

  for (const line of lines) {
    if (line === layout.headerLine) continue;
    const match = matchNutrient(line);
    if (!match) continue;

    // The rule that matters: a sub-nutrient row never fills its parent's slot.
    const key = match.key;
    if (found.has(key)) continue;

    const nums = extractNumbers(line);
    if (nums.length === 0) continue;

    const chosen = key === 'energy' ? null : pickNumber(nums, layout.index);
    const value =
      key === 'energy'
        ? energyKcal(nums, layout.index)
        : (chosen?.value ?? null);
    if (value === null) continue;

    // Energy is stated in kcal or kJ, never grams, so it is not subject to the
    // welded-unit problem.
    const alternative = chosen ? unitWeldedAlternative(chosen) : null;

    // Where the rounding rule is decisive, take the repaired reading up front
    // and leave the literal one as the fallback for the Atwater arbitration.
    const swap = preferByRounding(value, alternative);
    alternatives.set(key, swap ? value : alternative);
    found.set(key, {
      value: swap ? (alternative as number) : value,
      confidence: swap ? REPAIRED_CONFIDENCE : CONFIDENCE[match.quality],
      sourceLine: line,
    });
  }

  const field = (k: NutrientKey): Field => found.get(k) ?? EMPTY;
  const energy = field('energy');
  const protein = field('protein');
  const carbs = field('carbs');
  const fat = field('fat');

  const complete =
    energy.value !== null &&
    protein.value !== null &&
    carbs.value !== null &&
    fat.value !== null;

  /**
   * With all four numbers present the label is over-determined: the calories
   * should follow from the macros. That redundancy is what decides between a
   * value and its welded-unit alternative -- we take the reading that
   * reconciles, rather than guessing at the character level.
   */
  let repaired = new Set<NutrientKey>();
  let atwaterOk = false;
  let values = {
    kcal: energy.value ?? 0,
    proteinG: protein.value ?? 0,
    carbsG: carbs.value ?? 0,
    fatG: fat.value ?? 0,
  };

  if (complete) {
    const candidates = [
      ['protein', protein.value as number, alternatives.get('protein') ?? null],
      ['carbs', carbs.value as number, alternatives.get('carbs') ?? null],
      ['fat', fat.value as number, alternatives.get('fat') ?? null],
    ] as const;

    for (const reading of readings(candidates)) {
      const trial = {
        kcal: energy.value as number,
        proteinG: reading.get('protein')!.value,
        carbsG: reading.get('carbs')!.value,
        fatG: reading.get('fat')!.value,
      };
      if (!atwaterAgrees(trial)) continue;
      values = trial;
      atwaterOk = true;
      repaired = new Set(
        [...reading.entries()]
          .filter(([, v]) => v.repaired)
          .map(([k]) => k as NutrientKey),
      );
      break;
    }
  }

  // Nothing reconciled: keep the literal reading and flag the whole set, since
  // we know one of the four is wrong but not which.
  const penalty = complete && !atwaterOk ? 0.5 : 1;
  const finalise = (k: NutrientKey, f: Field, value: number): Field => {
    if (f.value === null) return f;
    const confidence = repaired.has(k)
      ? REPAIRED_CONFIDENCE
      : round(f.confidence * penalty, 2);
    return { ...f, value, confidence };
  };

  return {
    kcal100g: finalise('energy', energy, values.kcal),
    protein100g: finalise('protein', protein, values.proteinG),
    carbs100g: finalise('carbs', carbs, values.carbsG),
    fat100g: finalise('fat', fat, values.fatG),
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
