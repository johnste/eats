import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createOffClient, OffUnavailableError } from '../src/lib/off.ts';

/** Shapes captured from the live service on 2026-09-18. */
const PRODUCT_OK = {
  code: '7622210449283',
  status: 1,
  product: {
    code: '7622210449283',
    product_name: 'Prince',
    brands: 'LU, Mondelez Schweiz GmbH',
    quantity: '300 g e',
    serving_size: '250g',
    nutriments: {
      'energy-kcal_100g': 466,
      'energy-kj_100g': 1957,
      proteins_100g: 6.3,
      carbohydrates_100g: 68,
      fat_100g: 17,
    },
  },
};

/** The search index types `brands` as an array; the product endpoint doesn't. */
const SEARCH_OK = {
  count: 46,
  hits: [
    { code: '7340191158016', product_name: 'Havregryn', brands: ['365'] },
    { code: '5712873708642', product_name: 'Havregryn', brands: ['Salling'] },
    { code: '999', brands: ['NoName'] }, // no name: must be dropped
  ],
};

function clientReturning(body: unknown, init: { status?: number; text?: string } = {}) {
  const fetchImpl = (async () =>
    new Response(init.text ?? JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  return createOffClient({ userAgent: 'test', fetchImpl });
}

describe('off.product', () => {
  it('maps a complete product to per-100g macros', async () => {
    const r = await clientReturning(PRODUCT_OK).product('7622210449283');
    assert.equal(r.status, 'ok');
    if (r.status !== 'ok') return;
    assert.equal(r.name, 'Prince');
    assert.equal(r.brand, 'LU', 'takes the first of a comma-separated brand list');
    assert.deepEqual(r.macros, {
      kcal100g: 466,
      protein100g: 6.3,
      carbs100g: 68,
      fat100g: 17,
    });
  });

  it('never reads the package quantity as a serving size', async () => {
    const body = structuredClone(PRODUCT_OK);
    delete (body.product as { serving_size?: string }).serving_size;
    const r = await clientReturning(body).product('7622210449283');
    assert.equal(r.status, 'ok');
    if (r.status !== 'ok') return;
    // quantity is "300 g e" -- that is the packet, not a portion.
    assert.equal(r.servingG, null);
  });

  it('converts kJ when the kcal figure is absent', async () => {
    const body = structuredClone(PRODUCT_OK);
    delete (body.product.nutriments as Record<string, unknown>)['energy-kcal_100g'];
    const r = await clientReturning(body).product('x');
    assert.equal(r.status, 'ok');
    if (r.status !== 'ok') return;
    assert.equal(r.macros.kcal100g, 468); // 1957 / 4.184
  });

  it('reports incomplete rather than defaulting a missing macro to zero', async () => {
    const body = structuredClone(PRODUCT_OK);
    delete (body.product.nutriments as Record<string, unknown>).proteins_100g;
    const r = await clientReturning(body).product('x');
    assert.equal(r.status, 'incomplete');
    if (r.status !== 'incomplete') return;
    assert.deepEqual(r.missing, ['protein']);
    // The name survives so it can prefill the manual entry form.
    assert.equal(r.name, 'Prince');
  });

  it('rejects implausible values that would poison the log', async () => {
    const body = structuredClone(PRODUCT_OK);
    body.product.nutriments.fat_100g = 830; // a per-serving figure filed as per-100g
    const r = await clientReturning(body).product('x');
    assert.equal(r.status, 'incomplete');
  });

  it('parses string-typed nutriments, which OFF sometimes returns', async () => {
    const body = structuredClone(PRODUCT_OK);
    (body.product.nutriments as Record<string, unknown>).proteins_100g = '6.3';
    const r = await clientReturning(body).product('x');
    assert.equal(r.status, 'ok');
  });

  it('treats a product filled in with zeros as having no data', async () => {
    const body = structuredClone(PRODUCT_OK);
    body.product.nutriments = {
      'energy-kcal_100g': 0,
      'energy-kj_100g': 0,
      proteins_100g: 0,
      carbohydrates_100g: 0,
      fat_100g: 0,
    };
    const r = await clientReturning(body).product('x');
    // Four parseable zeros is what an unfilled product looks like. Logging it
    // would add nothing, so it is offered as something to fill in instead.
    assert.equal(r.status, 'incomplete');
    if (r.status !== 'incomplete') return;
    assert.deepEqual(r.missing, ['nutrition data']);
    assert.equal(r.name, 'Prince');
  });

  it('honours OFF\'s own no-nutrition-table flag, which it writes as "on"', async () => {
    const body = structuredClone(PRODUCT_OK) as Record<string, any>;
    body.product.no_nutrition_data = 'on';
    const r = await clientReturning(body).product('x');
    assert.equal(r.status, 'incomplete');
    if (r.status !== 'incomplete') return;
    assert.deepEqual(r.missing, ['nutrition data']);
    // The declared portion is still worth carrying to the manual form.
    assert.equal(r.servingG, 250);
  });

  it('keeps a product that is zero in one macro but not all of them', async () => {
    const body = structuredClone(PRODUCT_OK);
    body.product.nutriments.fat_100g = 0;
    const r = await clientReturning(body).product('x');
    assert.equal(r.status, 'ok', 'a fat-free food is still a food');
  });

  it('treats an unknown barcode as not found', async () => {
    const r = await clientReturning({ status: 0 }).product('0000000000000');
    assert.equal(r.status, 'not_found');
  });
});

describe('off.search', () => {
  it('reads the array-typed brands field the search index uses', async () => {
    const hits = await clientReturning(SEARCH_OK).search('havregryn');
    assert.equal(hits.length, 2, 'the nameless hit is dropped');
    assert.deepEqual(hits[0], {
      barcode: '7340191158016',
      name: 'Havregryn',
      brand: '365',
    });
  });
});

describe('off failure handling', () => {
  it('raises a typed error on the HTML maintenance page', async () => {
    const c = clientReturning(null, { text: '<!DOCTYPE html><html>down</html>' });
    await assert.rejects(() => c.product('x'), OffUnavailableError);
  });

  it('raises a typed error on a server failure', async () => {
    const c = clientReturning(null, { status: 503, text: 'nope' });
    await assert.rejects(() => c.search('x'), OffUnavailableError);
  });

  it('raises a typed error when the network is unreachable', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const c = createOffClient({ userAgent: 'test', fetchImpl });
    await assert.rejects(() => c.product('x'), OffUnavailableError);
  });
});
