import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  rankSuggestions,
  slotFit,
  weightFit,
  type SuggestedFood,
  type SuggestResponse,
} from '@eats/shared';

const food = (
  name: string,
  usualGrams: number | null,
  stats: { meals?: number; first?: number; together?: number },
): SuggestedFood => ({
  id: name,
  source: 'custom',
  name,
  brand: null,
  barcode: null,
  estimated: false,
  kcal100g: 100,
  protein100g: 1,
  carbs100g: 1,
  fat100g: 1,
  servings: [],
  usualGrams,
  meals: 0,
  first: 0,
  together: 0,
  ...stats,
});

// Thirty breakfasts: yoghurt, oats and honey on most, bread, butter and
// cheese on the rest.
const breakfast: SuggestResponse = {
  mealDays: 30,
  context: [],
  contextMeals: 0,
  foods: [
    food('honey', 15, { meals: 23 }),
    food('yoghurt', 250, { meals: 23, first: 23 }),
    food('oats', 40, { meals: 23 }),
    food('coffee', 200, { meals: 10 }),
    food('bread', 45, { meals: 7, first: 7 }),
    food('cheese', 20, { meals: 7 }),
    food('butter', 10, { meals: 7 }),
    food('once', 30, { meals: 1, first: 1 }),
  ],
};

const names = (list: SuggestedFood[]) => list.map((f) => f.name);

describe('weightFit', () => {
  it('is 1 for the usual amount and falls away either side alike', () => {
    assert.equal(weightFit(40, 40), 1);
    assert.ok(Math.abs(weightFit(80, 40) - weightFit(20, 40)) < 1e-9);
    assert.ok(weightFit(45, 40) > 0.9);
    assert.ok(weightFit(250, 40) < 0.01);
  });
});

describe('slotFit', () => {
  it('says nothing with no weights waiting', () => {
    assert.equal(slotFit(40, []), null);
  });

  it('counts the next weight fully and the others less', () => {
    assert.equal(slotFit(40, [40, 10]), 1);
    assert.ok(slotFit(10, [40, 10])! < 1);
    assert.equal(slotFit(10, [40, 10], 1), 1);
  });

  it('neither rewards nor rules out a food with no usual amount', () => {
    const unknown = slotFit(null, [40])!;
    assert.ok(unknown > slotFit(250, [40])!);
    assert.ok(unknown < slotFit(40, [40])!);
  });
});

describe('rankSuggestions', () => {
  it('starts an empty meal with what it usually starts with', () => {
    assert.equal(rankSuggestions(breakfast, { grams: [] })[0]?.name, 'yoghurt');
  });

  it('leaves out one-offs and what is already picked', () => {
    const ranked = names(
      rankSuggestions(breakfast, { grams: [], exclude: ['yoghurt'] }),
    );
    assert.ok(!ranked.includes('once'));
    assert.ok(!ranked.includes('yoghurt'));
  });

  it('brings up what fits the weights waiting', () => {
    const ranked = names(rankSuggestions(breakfast, { grams: [45, 10, 20] }));
    // The 45 is next: bread or oats, not 250 g of yoghurt.
    assert.deepEqual(ranked.slice(0, 2).sort(), ['bread', 'oats']);
    assert.ok(ranked.indexOf('yoghurt') > ranked.indexOf('bread'));
  });

  it('follows the weight you chose to fill next', () => {
    const ranked = names(
      rankSuggestions(breakfast, { grams: [45, 250], activeIndex: 1 }),
    );
    assert.equal(ranked[0], 'yoghurt');
  });

  it('goes with what is already in the meal', () => {
    const withBread: SuggestResponse = {
      ...breakfast,
      context: [{ id: 'bread', name: 'bread' }],
      contextMeals: 7,
      foods: breakfast.foods
        .filter((f) => f.id !== 'bread')
        .map((f) =>
          f.id === 'butter' || f.id === 'cheese'
            ? { ...f, together: 7 }
            : f.id === 'coffee'
              ? { ...f, together: 2 }
              : f,
        ),
    };
    const ranked = names(rankSuggestions(withBread, { grams: [] }));
    assert.deepEqual(ranked.slice(0, 2).sort(), ['butter', 'cheese']);
    // And a weight picks between them.
    assert.equal(rankSuggestions(withBread, { grams: [20] })[0]?.name, 'cheese');
    assert.equal(rankSuggestions(withBread, { grams: [10] })[0]?.name, 'butter');
  });

  it('offers at most a handful', () => {
    assert.ok(rankSuggestions(breakfast, { grams: [] }).length <= 6);
  });
});
