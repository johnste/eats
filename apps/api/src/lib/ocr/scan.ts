import { parseNutritionText, type ParseResult } from './parse.ts';
import { preprocess, recognize } from './tesseract.ts';

/**
 * Tesseract's page segmentation mode is a guess about the shape of the text,
 * and the right guess differs per label. A flat printed table reads best as a
 * uniform block; a curved bottle, a wrapped linear declaration, or a label
 * photographed at an angle often reads far better as a single column or as
 * sparse text.
 *
 * Rather than pick one and hope, try them in order of likelihood and keep the
 * best reading. The first mode is right for most labels, so the extra passes
 * are only paid for the awkward ones.
 */
const MODES = [
  6, // a single uniform block of text -- a printed nutrition table
  4, // a single column of variable-sized text -- wrapped or linear labels
  11, // sparse text, no particular order -- curved surfaces and poor contrast
] as const;

const STORED = ['kcal100g', 'protein100g', 'carbs100g', 'fat100g'] as const;

/**
 * How good a reading is: how many of the four values it found, whether they
 * reconcile against the stated calories, and how confident the parser was.
 * Values found dominates -- a complete reading that needed a repair beats a
 * pristine one that only found two numbers.
 */
export function scoreReading(result: ParseResult): number {
  const fields = STORED.map((k) => result[k]);
  const found = fields.filter((f) => f.value !== null).length;
  const confidence = fields.reduce((sum, f) => sum + f.confidence, 0) / fields.length;
  return found * 10 + (result.atwaterOk ? 5 : 0) + confidence;
}

/** Nothing further to gain: all four values, and they add up. */
const isComplete = (r: ParseResult): boolean =>
  STORED.every((k) => r[k].value !== null) && r.atwaterOk;

export interface ScanOutcome extends ParseResult {
  /** Which segmentation mode produced this reading, for diagnostics. */
  psm: number;
  /** How many passes it took. */
  attempts: number;
}

export async function scanLabel(image: Buffer): Promise<ScanOutcome> {
  // Preprocessing is independent of segmentation mode, so it happens once.
  const prepared = await preprocess(image);

  let best: ScanOutcome | null = null;
  let bestScore = -Infinity;

  for (const [index, psm] of MODES.entries()) {
    const result = parseNutritionText(await recognize(prepared, { psm }));
    const score = scoreReading(result);

    if (score > bestScore) {
      bestScore = score;
      best = { ...result, psm, attempts: index + 1 };
    }
    if (isComplete(result)) break;
  }

  // MODES is non-empty, so the loop always assigns.
  return best as ScanOutcome;
}
