import { kjToKcal, round } from '@eats/shared';
import { z } from 'zod';

/**
 * Open Food Facts client. Called server-side only: it sidesteps CORS, lets us
 * cache into our own foods table, and keeps the descriptive User-Agent that OFF
 * asks for (and rate-limits on) attached to every request.
 *
 * Two endpoints, because they carry different data:
 *   - search.openfoodfacts.org indexes names and barcodes but NOT nutriments,
 *     so search results are candidates, not foods.
 *   - /api/v2/product/{barcode} has the nutriments, and is what resolves a
 *     candidate once the user actually picks it.
 * The legacy cgi/search.pl endpoint is not used; it is frequently down.
 */

const SEARCH_URL = 'https://search.openfoodfacts.org/search';
const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

/** Values OFF returns as strings, empty strings, or nulls on a bad day. */
const loose = z.preprocess((v) => {
  if (v === '' || v === null || v === undefined) return undefined;
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}, z.number().optional());

const nutrimentsSchema = z
  .object({
    'energy-kcal_100g': loose,
    'energy-kj_100g': loose,
    proteins_100g: loose,
    carbohydrates_100g: loose,
    fat_100g: loose,
  })
  .passthrough();

/**
 * The same field is typed differently by the two endpoints: /api/v2/product
 * returns `brands` as a comma-separated string, the search index returns it as
 * an array. Accept both rather than letting one shape fail the whole parse.
 */
const brandsField = z
  .union([z.string(), z.array(z.string())])
  .optional();

const productSchema = z.object({
  code: z.string(),
  product_name: z.string().optional(),
  product_name_en: z.string().optional(),
  brands: brandsField,
  quantity: z.string().optional(),
  serving_size: z.string().optional(),
  nutriments: nutrimentsSchema.optional(),
});

const searchResponseSchema = z.object({
  count: z.number().optional(),
  hits: z.array(productSchema.partial({ code: true }).passthrough()).default([]),
});

export interface OffCandidate {
  barcode: string;
  name: string;
  brand: string | null;
}

export interface OffMacros {
  kcal100g: number;
  protein100g: number;
  carbs100g: number;
  fat100g: number;
}

export type OffProduct =
  | { status: 'ok'; barcode: string; name: string; brand: string | null; servingG: number | null; macros: OffMacros }
  /** Found, but the nutrition data is missing or unusable. The name and brand
   *  are still worth returning: they prefill the manual entry form. */
  | { status: 'incomplete'; barcode: string; name: string; brand: string | null; servingG: number | null; missing: string[] }
  | { status: 'not_found'; barcode: string };

export class OffUnavailableError extends Error {}

export interface OffClientOptions {
  userAgent: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createOffClient(opts: OffClientOptions) {
  const { userAgent, timeoutMs = 8000, fetchImpl = fetch } = opts;

  async function call(url: string): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(url, {
        signal,
        headers: { 'User-Agent': userAgent, Accept: 'application/json' },
      });
    } catch (cause) {
      throw new OffUnavailableError('Open Food Facts is not responding.', { cause });
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new OffUnavailableError(`Open Food Facts returned ${res.status}.`);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // OFF serves an HTML maintenance page under load.
      throw new OffUnavailableError('Open Food Facts returned an unexpected response.');
    }
  }

  function displayName(p: z.infer<typeof productSchema>): string {
    return (p.product_name || p.product_name_en || '').trim();
  }

  function brandOf(p: { brands?: string | string[] | undefined }): string | null {
    const raw = Array.isArray(p.brands) ? p.brands[0] : p.brands?.split(',')[0];
    const first = raw?.trim();
    return first && first.length > 0 ? first : null;
  }

  /**
   * "30 g" / "2 biscuits (25 g)" -> 30 / 25.
   * Only ever called with serving_size. `quantity` is the package size, which
   * is a different thing entirely -- a 300 g packet of biscuits is not a
   * 300 g serving.
   *
   * Even serving_size is only a suggestion: OFF is crowd-sourced and really
   * does claim a 250 g serving for that packet of biscuits. It surfaces as a
   * tappable shortcut next to an editable gram field, never as the logged
   * amount, so a wrong one is visible rather than silently eaten.
   */
  function servingGrams(raw: string | undefined): number | null {
    if (!raw) return null;
    const m = raw.match(/(\d+(?:[.,]\d+)?)\s*g/i);
    if (!m?.[1]) return null;
    const v = Number.parseFloat(m[1].replace(',', '.'));
    return Number.isFinite(v) && v > 0 && v <= 5000 ? v : null;
  }

  return {
    /** Names and barcodes only; nutriments are not in this index. */
    async search(query: string, limit = 20): Promise<OffCandidate[]> {
      const url = `${SEARCH_URL}?q=${encodeURIComponent(query)}&page_size=${limit}`;
      const parsed = searchResponseSchema.safeParse(await call(url));
      if (!parsed.success) return [];
      return parsed.data.hits.flatMap((h) => {
        const name = displayName(h as z.infer<typeof productSchema>);
        const barcode = h.code;
        if (!name || !barcode) return [];
        return [{ barcode, name, brand: brandOf(h) }];
      });
    },

    async product(barcode: string): Promise<OffProduct> {
      const fields =
        'code,product_name,product_name_en,brands,quantity,serving_size,nutriments';
      const url = `${PRODUCT_URL}/${encodeURIComponent(barcode)}.json?fields=${fields}`;
      const body = await call(url);
      if (!body || typeof body !== 'object') return { status: 'not_found', barcode };

      const raw = (body as { product?: unknown }).product;
      const parsed = productSchema.safeParse(raw);
      if (!parsed.success) return { status: 'not_found', barcode };

      const p = parsed.data;
      const name = displayName(p);
      const brand = brandOf(p);
      const servingG = servingGrams(p.serving_size);
      const n = p.nutriments ?? {};

      // Crowd-sourced data: any of these can be absent or nonsense. Prefer the
      // kcal figure, fall back to converting kJ, give up rather than guess.
      const kcal =
        n['energy-kcal_100g'] ??
        (n['energy-kj_100g'] !== undefined
          ? round(kjToKcal(n['energy-kj_100g']), 0)
          : undefined);

      const missing: string[] = [];
      if (kcal === undefined) missing.push('calories');
      if (n.proteins_100g === undefined) missing.push('protein');
      if (n.carbohydrates_100g === undefined) missing.push('carbohydrates');
      if (n.fat_100g === undefined) missing.push('fat');

      if (!name || missing.length > 0) {
        return {
          status: 'incomplete',
          barcode: p.code,
          name: name || '',
          brand,
          servingG,
          missing: name ? missing : [...missing, 'name'],
        };
      }

      const macros: OffMacros = {
        kcal100g: kcal as number,
        protein100g: n.proteins_100g as number,
        carbs100g: n.carbohydrates_100g as number,
        fat100g: n.fat_100g as number,
      };

      // Guard against transcription errors in the source data (a per-serving
      // figure filed as per-100g, a decimal point in the wrong place).
      const outOfRange =
        macros.kcal100g > 900 ||
        macros.protein100g > 100 ||
        macros.carbs100g > 100 ||
        macros.fat100g > 100 ||
        Object.values(macros).some((v) => v < 0);
      if (outOfRange) {
        return {
          status: 'incomplete',
          barcode: p.code,
          name,
          brand,
          servingG,
          missing: ['plausible nutrition values'],
        };
      }

      return { status: 'ok', barcode: p.code, name, brand, servingG, macros };
    },
  };
}

export type OffClient = ReturnType<typeof createOffClient>;
