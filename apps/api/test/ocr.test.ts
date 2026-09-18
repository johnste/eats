import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  detectLayout,
  editDistance,
  extractNumbers,
  extractServingGrams,
  matchNutrient,
  normalizeLine,
  parseNutritionText,
} from '../src/lib/ocr/parse.ts';

/** A typical Swedish label: kJ first, comma decimals, two sub-nutrient rows. */
const SWEDISH = `
Näringsvärde per 100 g
Energi 1554 kJ / 371 kcal
Fett 6,2 g
varav mättat fett 1,1 g
Kolhydrat 66 g
varav sockerarter 8,5 g
Fiber 9,8 g
Protein 11 g
Salt 0,01 g
`;

const ENGLISH = `
Nutrition Information per 100g
Energy 1554kJ / 371kcal
Fat 6.2g
of which saturates 1.1g
Carbohydrate 66g
of which sugars 8.5g
Fibre 9.8g
Protein 11g
Salt 0.01g
`;

/** Per 100 g and per portion side by side, per 100 g first as the law requires. */
const TWO_COLUMN = `
Näringsvärde per 100 g per portion (40 g)
Energi 1554 kJ / 371 kcal 622 kJ / 148 kcal
Fett 6,2 g 2,5 g
varav mättat fett 1,1 g 0,4 g
Kolhydrat 66 g 26 g
varav sockerarter 8,5 g 3,4 g
Protein 11 g 4,4 g
Salt 0,01 g 0,004 g
`;

/** Some labels lead with the portion column; the header is the only clue. */
const PORTION_FIRST = `
Näringsvärde per portion (40 g) per 100 g
Energi 622 kJ / 148 kcal 1554 kJ / 371 kcal
Fett 2,5 g 6,2 g
Kolhydrat 26 g 66 g
Protein 4,4 g 11 g
`;

/** Older labels sometimes print kJ only. */
const KJ_ONLY = `
Näringsvärde per 100 g
Energi 1554 kJ
Fett 6,2 g
Kolhydrat 66 g
Protein 11 g
`;

describe('normalizeLine', () => {
  it('repairs OCR digit confusions inside numeric tokens only', () => {
    assert.equal(normalizeLine('Energi 1OO kcal'), 'energi 100 kcal');
    assert.equal(normalizeLine('Fett l2,5 g'), 'fett 12,5 g');
    // "Protein" must survive: it has an o and an i but is not a number.
    assert.equal(normalizeLine('Protein 8 g'), 'protein 8 g');
    assert.equal(normalizeLine('Kolhydrat 45 g'), 'kolhydrat 45 g');
  });

  it('collapses whitespace and lowercases', () => {
    assert.equal(normalizeLine('  Fett\t\t6,2   g  '), 'fett 6,2 g');
  });
});

describe('extractNumbers', () => {
  it('reads comma decimals as decimals, not thousands', () => {
    assert.deepEqual(extractNumbers('fett 6,2 g'), [{ value: 6.2, unit: 'g' }]);
  });

  it('treats a space-separated group as one number', () => {
    assert.deepEqual(extractNumbers('energi 1 554 kj'), [{ value: 1554, unit: 'kj' }]);
  });

  it('keeps both figures on an energy row', () => {
    assert.deepEqual(extractNumbers('energi 1554 kj / 371 kcal'), [
      { value: 1554, unit: 'kj' },
      { value: 371, unit: 'kcal' },
    ]);
  });
});

describe('matchNutrient', () => {
  it('flags "varav" rows as sub-nutrients', () => {
    assert.deepEqual(matchNutrient('varav mättat fett 1,1 g'), {
      key: 'saturates',
      isSub: true,
      quality: 'exact',
    });
    assert.deepEqual(matchNutrient('varav sockerarter 8,5 g'), {
      key: 'sugars',
      isSub: true,
      quality: 'exact',
    });
  });

  it('matches saturates before fat even without a varav marker', () => {
    assert.equal(matchNutrient('mättat fett 1,1 g')?.key, 'saturates');
    assert.equal(matchNutrient('of which saturates 1.1g')?.key, 'saturates');
  });

  it('recovers from a mangled character', () => {
    const m = matchNutrient('kolhydraf 45 g');
    assert.equal(m?.key, 'carbs');
    assert.equal(m?.quality, 'fuzzy');
  });

  it('returns null for rows that are not nutrients', () => {
    assert.equal(matchNutrient('ingredienser: havre, vatten'), null);
  });
});

describe('editDistance', () => {
  it('measures small typos and bails out on distant strings', () => {
    assert.equal(editDistance('kolhydrat', 'kolhydrat'), 0);
    assert.equal(editDistance('kolhydraf', 'kolhydrat'), 1);
    assert.ok(editDistance('havre', 'kolhydrat') > 3);
  });
});

describe('detectLayout', () => {
  it('defaults to the first column when per 100 g leads', () => {
    const l = detectLayout(['näringsvärde per 100 g per portion (40 g)']);
    assert.equal(l.column, 'per_100g');
    assert.equal(l.index, 0);
    assert.equal(l.servingG, 40);
  });

  it('takes the second column when the portion column is printed first', () => {
    const l = detectLayout(['näringsvärde per portion (40 g) per 100 g']);
    assert.equal(l.column, 'per_100g');
    assert.equal(l.index, 1);
  });
});

describe('extractServingGrams', () => {
  it('reads the declared portion size', () => {
    assert.equal(extractServingGrams('per portion (40 g)'), 40);
    assert.equal(extractServingGrams('serving size 30 g'), 30);
    assert.equal(extractServingGrams('näringsvärde per 100 g'), null);
  });
});

describe('parseNutritionText', () => {
  it('parses a Swedish label', () => {
    const r = parseNutritionText(SWEDISH);
    assert.equal(r.kcal100g.value, 371);
    assert.equal(r.fat100g.value, 6.2);
    assert.equal(r.carbs100g.value, 66);
    assert.equal(r.protein100g.value, 11);
    assert.equal(r.detectedLanguage, 'sv');
    assert.equal(r.atwaterOk, true);
  });

  it('parses an English label to the same numbers', () => {
    const r = parseNutritionText(ENGLISH);
    assert.equal(r.kcal100g.value, 371);
    assert.equal(r.fat100g.value, 6.2);
    assert.equal(r.carbs100g.value, 66);
    assert.equal(r.protein100g.value, 11);
    assert.equal(r.detectedLanguage, 'en');
  });

  it('never lets a sub-nutrient overwrite its parent', () => {
    const r = parseNutritionText(SWEDISH);
    // 8,5 is the sugar figure and 1,1 the saturates figure -- neither may end
    // up in the carb or fat slot. This is the failure that would go unnoticed.
    assert.equal(r.carbs100g.value, 66);
    assert.notEqual(r.carbs100g.value, 8.5);
    assert.equal(r.fat100g.value, 6.2);
    assert.notEqual(r.fat100g.value, 1.1);
  });

  it('takes the per-100g column from a two-column table', () => {
    const r = parseNutritionText(TWO_COLUMN);
    assert.equal(r.kcal100g.value, 371);
    assert.equal(r.fat100g.value, 6.2);
    assert.equal(r.carbs100g.value, 66);
    assert.equal(r.protein100g.value, 11);
    assert.equal(r.servingG.value, 40);
  });

  it('still finds per-100g when the portion column is printed first', () => {
    const r = parseNutritionText(PORTION_FIRST);
    assert.equal(r.kcal100g.value, 371);
    assert.equal(r.fat100g.value, 6.2);
    assert.equal(r.carbs100g.value, 66);
    assert.equal(r.protein100g.value, 11);
  });

  it('converts kJ when no kcal figure is printed', () => {
    const r = parseNutritionText(KJ_ONLY);
    assert.equal(r.kcal100g.value, 371); // 1554 / 4.184
  });

  it('lowers confidence on every macro when the Atwater check fails', () => {
    const bogus = `
      Näringsvärde per 100 g
      Energi 100 kcal
      Fett 50 g
      Kolhydrat 50 g
      Protein 50 g
    `;
    const r = parseNutritionText(bogus);
    assert.equal(r.atwaterOk, false);
    assert.ok(r.carbs100g.confidence < 0.6, 'confidence should be penalised');
  });

  /**
   * Tesseract welds a value's unit onto its number, and it is the nastiest
   * failure mode here because the result still looks like a number. These are
   * real outputs observed from the binary, not invented ones.
   */
  describe('welded units', () => {
    const WELDED = `
      Näringsvärde per 100 g
      Energi 1554 kJ / 371 kcal
      Fett 6,29
      varav mättat fett 1,19
      Kolhydrat 66 g
      varav sockerarter 8,59g
      Protein 119g
      Salt 0,01 g
    `;

    it('recovers the real values from welded units', () => {
      const r = parseNutritionText(WELDED);
      assert.equal(r.fat100g.value, 6.2, '6,29 is 6,2 g');
      assert.equal(r.protein100g.value, 11, '119g is 11 g');
      assert.equal(r.carbs100g.value, 66);
      assert.equal(r.kcal100g.value, 371);
      assert.equal(r.atwaterOk, true);
    });

    it('marks repaired values as lower confidence than clean ones', () => {
      const r = parseNutritionText(WELDED);
      assert.ok(
        r.protein100g.confidence < r.carbs100g.confidence,
        'a repaired value must not look as trustworthy as a clean one',
      );
    });

    it('leaves a legitimate value ending in 9 alone', () => {
      // 49 g of carbs reconciles as-is, so nothing should be "repaired" to 4.
      const r = parseNutritionText(`
        per 100 g
        Energi 300 kcal
        Fett 5 g
        Kolhydrat 49 g
        Protein 12 g
      `);
      assert.equal(r.carbs100g.value, 49);
      assert.equal(r.atwaterOk, true);
    });

    it('does not repair a two-decimal value when no unit was welded', () => {
      // Salt-style precision on a macro is odd but must not be silently edited
      // when the arithmetic already works.
      const r = parseNutritionText(`
        per 100 g
        Energi 100 kcal
        Fett 1 g
        Kolhydrat 20 g
        Protein 3 g
      `);
      assert.equal(r.fat100g.value, 1);
      assert.equal(r.carbs100g.value, 20);
    });
  });

  /**
   * Reg. 1169/2011 Article 34 permits a linear declaration -- a sentence
   * rather than a table -- where there is no room for one. Bottles and small
   * packets use it constantly, and a line-based parser reads only the first
   * nutrient and drops the rest.
   */
  describe('linear declarations', () => {
    it('reads a Swedish run-on declaration', () => {
      const r = parseNutritionText(
        'Näringsvärde per 100 g: energi 1554 kJ/371 kcal, fett 6,2 g varav ' +
          'mättat fett 1,1 g, kolhydrat 66 g varav sockerarter 8,5 g, ' +
          'fiber 9,8 g, protein 11 g, salt 0,01 g',
      );
      assert.equal(r.kcal100g.value, 371);
      assert.equal(r.fat100g.value, 6.2);
      assert.equal(r.carbs100g.value, 66);
      assert.equal(r.protein100g.value, 11);
      assert.equal(r.atwaterOk, true);
    });

    it('reads an English run-on declaration', () => {
      const r = parseNutritionText(
        'Typical values per 100g: Energy 1554kJ/371kcal, Fat 6.2g of which ' +
          'saturates 1.1g, Carbohydrate 66g of which sugars 8.5g, ' +
          'Protein 11g, Salt 0.01g',
      );
      assert.equal(r.kcal100g.value, 371);
      assert.equal(r.fat100g.value, 6.2);
      assert.equal(r.carbs100g.value, 66);
      assert.equal(r.protein100g.value, 11);
    });

    it('does not let a run-on sub-nutrient capture its parent', () => {
      // The whole risk of linear format: "fett 6,2 g varav mättat fett 1,1 g"
      // on one line must not put 1,1 in the fat slot, nor 8,5 in carbs.
      const r = parseNutritionText(
        'per 100 g: energi 371 kcal, fett 6,2 g varav mättat fett 1,1 g, ' +
          'kolhydrat 66 g varav sockerarter 8,5 g, protein 11 g',
      );
      assert.equal(r.fat100g.value, 6.2);
      assert.notEqual(r.fat100g.value, 1.1);
      assert.equal(r.carbs100g.value, 66);
      assert.notEqual(r.carbs100g.value, 8.5);
    });

    it('handles a declaration wrapped across several lines', () => {
      // OCR of a curved bottle rarely gives clean line breaks.
      const r = parseNutritionText(
        'Näringsvärde per 100 ml: energi 180 kJ/\n43 kcal, fett 0 g,\n' +
          'kolhydrat 10,6 g varav\nsockerarter 10,6 g, protein 0,5 g',
      );
      assert.equal(r.kcal100g.value, 43);
      assert.equal(r.fat100g.value, 0);
      assert.equal(r.carbs100g.value, 10.6);
      assert.equal(r.protein100g.value, 0.5);
    });

    it('stops a value running on into unrelated trailing text', () => {
      const r = parseNutritionText(
        'per 100 g: energi 371 kcal, fett 6,2 g, kolhydrat 66 g, protein 11 g. ' +
          'Ingredienser: havregryn 100%. Nettovikt 500 g.',
      );
      assert.equal(r.protein100g.value, 11);
    });
  });

  it('reports missing fields as null rather than zero', () => {
    const r = parseNutritionText('Ingredienser: havre, vatten, salt');
    assert.equal(r.kcal100g.value, null);
    assert.equal(r.protein100g.value, null);
    assert.equal(r.atwaterOk, false);
  });
});
