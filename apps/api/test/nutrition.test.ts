import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDays,
  ageFrom,
  targetCalories,
  atwaterAgrees,
  bmr,
  guessMeal,
  kjToKcal,
  MEALS,
  projectWeight,
  scaleMacros,
  suggestMacroSplit,
  sumMacros,
  tdee,
  toDateKey,
} from '@eats/shared';

const OATS = { kcal: 371, proteinG: 11, carbsG: 66, fatG: 6.2 };

describe('scaleMacros', () => {
  it('is identity at 100 g', () => {
    assert.deepEqual(scaleMacros(OATS, 100), OATS);
  });

  it('scales linearly and rounds sensibly', () => {
    assert.deepEqual(scaleMacros(OATS, 40), {
      kcal: 148,
      proteinG: 4.4,
      carbsG: 26.4,
      fatG: 2.5,
    });
  });

  it('handles fractional grams without float dust', () => {
    const r = scaleMacros({ kcal: 100, proteinG: 10, carbsG: 20, fatG: 30 }, 33.3);
    assert.deepEqual(r, { kcal: 33, proteinG: 3.3, carbsG: 6.7, fatG: 10 });
  });

  it('returns zeroes for a zero amount', () => {
    assert.deepEqual(scaleMacros(OATS, 0), {
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });
});

describe('sumMacros', () => {
  /**
   * Entries are summed from their already-rounded snapshots, not recomputed
   * from raw grams. 11 g/100g at 33.3 g is 3.663, stored as 3.7, so ten of
   * them total 37.0 rather than the 36.6 a raw recomputation would give.
   * That is the intended trade: the day total always equals the sum of the
   * numbers on screen, which matters more here than the third decimal place.
   */
  it('sums from the stored snapshots, so totals match what is displayed', () => {
    const entries = Array.from({ length: 10 }, () => scaleMacros(OATS, 33.3));
    const total = sumMacros(entries);
    assert.equal(total.kcal, 1240);
    assert.equal(total.proteinG, 37);
    assert.equal(
      total.proteinG,
      entries.reduce((a, e) => a + e.proteinG, 0),
      'total must equal the sum of the per-entry figures',
    );
  });

  it('returns zeroes for an empty day', () => {
    assert.deepEqual(sumMacros([]), {
      kcal: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
    });
  });
});

describe('atwaterAgrees', () => {
  it('accepts a real label', () => {
    // 11*4 + 66*4 + 6.2*9 = 363.8 against a stated 371 -- about 2% out.
    assert.equal(atwaterAgrees(OATS), true);
  });

  it('rejects macros that cannot produce the stated calories', () => {
    assert.equal(
      atwaterAgrees({ kcal: 100, proteinG: 50, carbsG: 50, fatG: 50 }),
      false,
    );
  });

  it('rejects a zero calorie figure rather than dividing by it', () => {
    assert.equal(atwaterAgrees({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }), false);
  });
});

describe('kjToKcal', () => {
  it('converts at 4.184 kJ per kcal', () => {
    assert.equal(Math.round(kjToKcal(1554)), 371);
  });
});

describe('bmr and tdee', () => {
  // Mifflin-St Jeor, worked by hand:
  // 10*80 + 6.25*180 - 5*35 + 5 = 800 + 1125 - 175 + 5 = 1755
  it('matches a hand-computed male figure', () => {
    assert.equal(bmr({ sex: 'male', weightKg: 80, heightCm: 180, ageYears: 35 }), 1755);
  });

  // 10*65 + 6.25*168 - 5*30 - 161 = 650 + 1050 - 150 - 161 = 1389
  it('matches a hand-computed female figure', () => {
    assert.equal(
      bmr({ sex: 'female', weightKg: 65, heightCm: 168, ageYears: 30 }),
      1389,
    );
  });

  it('applies the activity multiplier', () => {
    const r = tdee({
      sex: 'male',
      weightKg: 80,
      heightCm: 180,
      ageYears: 35,
      activityLevel: 'moderate',
    });
    assert.equal(r, Math.round(1755 * 1.55));
  });
});

describe('suggestMacroSplit', () => {
  it('anchors protein to bodyweight and lets carbs absorb the remainder', () => {
    const s = suggestMacroSplit({ calories: 2500, weightKg: 80 });
    assert.equal(s.proteinG, 144); // 80 * 1.8
    assert.equal(s.fatG, 78); // 2500 * 0.28 / 9
    // The three together should account for roughly the target.
    const kcal = s.proteinG * 4 + s.carbsG * 4 + s.fatG * 9;
    assert.ok(Math.abs(kcal - 2500) <= 4, `got ${kcal}`);
  });

  it('never returns negative carbs when protein and fat exceed the target', () => {
    const s = suggestMacroSplit({ calories: 800, weightKg: 120 });
    assert.ok(s.carbsG >= 0);
  });
});

describe('targetCalories', () => {
  it('maintains at TDEE', () => {
    const r = targetCalories({ tdee: 2753, goal: 'maintain', kgPerWeek: 0.5 });
    assert.equal(r.calories, 2753);
    assert.equal(r.dailyDelta, 0);
  });

  it('subtracts the energy in the fat being lost', () => {
    // 0.5 kg/week * 7700 kcal/kg / 7 days = 550 kcal/day.
    const r = targetCalories({ tdee: 2753, goal: 'lose', kgPerWeek: 0.5 });
    assert.equal(r.dailyDelta, -550);
    assert.equal(r.calories, 2203);
    assert.equal(r.limited, false);
  });

  it('adds for a surplus', () => {
    const r = targetCalories({ tdee: 2000, goal: 'gain', kgPerWeek: 0.25 });
    assert.equal(r.dailyDelta, 275);
    assert.equal(r.calories, 2275);
  });

  it('never suggests eating below resting expenditure', () => {
    // A 1 kg/week deficit on a small maintenance would land under BMR.
    const r = targetCalories({
      tdee: 1800,
      goal: 'lose',
      kgPerWeek: 1,
      bmr: 1500,
    });
    assert.equal(r.calories, 1500, 'floored at BMR');
    assert.equal(r.limited, true, 'and says the rate was not honoured');
  });

  it('caps an unreasonable rate rather than obeying it', () => {
    const fast = targetCalories({ tdee: 3000, goal: 'lose', kgPerWeek: 5 });
    const capped = targetCalories({ tdee: 3000, goal: 'lose', kgPerWeek: 1 });
    assert.equal(fast.calories, capped.calories);
  });

  it('treats a negative rate as its magnitude', () => {
    const r = targetCalories({ tdee: 2500, goal: 'lose', kgPerWeek: -0.5 });
    assert.equal(r.dailyDelta, -550);
  });
});

describe('suggestMacroSplit in a deficit', () => {
  it('raises protein per kg when cutting', () => {
    const maintain = suggestMacroSplit({ calories: 2200, weightKg: 82 });
    const cutting = suggestMacroSplit({
      calories: 2200,
      weightKg: 82,
      goal: 'lose',
    });
    assert.ok(
      cutting.proteinG > maintain.proteinG,
      'protein protects muscle when calories are scarce',
    );
    assert.equal(cutting.proteinG, 180); // 82 * 2.2
  });

  it('still accounts for roughly the target', () => {
    const s = suggestMacroSplit({ calories: 2200, weightKg: 82, goal: 'lose' });
    const kcal = s.proteinG * 4 + s.carbsG * 4 + s.fatG * 9;
    assert.ok(Math.abs(kcal - 2200) <= 5, `got ${kcal}`);
  });
});

describe('date helpers', () => {
  it('formats a local calendar day, not a UTC instant', () => {
    assert.equal(toDateKey(new Date(2026, 0, 5)), '2026-01-05');
  });

  it('steps across a month boundary', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  });

  it('steps across a DST change without losing a day', () => {
    // Sweden springs forward on 2026-03-29.
    assert.equal(addDays('2026-03-28', 1), '2026-03-29');
    assert.equal(addDays('2026-03-29', 1), '2026-03-30');
  });

  it('computes age without counting an unreached birthday', () => {
    assert.equal(ageFrom('1990-06-15', new Date(Date.UTC(2026, 5, 14))), 35);
    assert.equal(ageFrom('1990-06-15', new Date(Date.UTC(2026, 5, 15))), 36);
  });
});

describe('guessMeal', () => {
  const at = (h: number) => new Date(2026, 8, 20, h, 30);

  it('names the meal you are most likely adding to', () => {
    assert.equal(guessMeal(at(7)), 'breakfast');
    assert.equal(guessMeal(at(12)), 'lunch');
    assert.equal(guessMeal(at(18)), 'dinner');
    assert.equal(guessMeal(at(22)), 'snack');
  });

  it('puts the boundaries on the later meal', () => {
    // 10:00 is lunch rather than breakfast, and so on -- a late breakfast is
    // rarer than an early lunch.
    assert.equal(guessMeal(new Date(2026, 8, 20, 9, 59)), 'breakfast');
    assert.equal(guessMeal(new Date(2026, 8, 20, 10, 0)), 'lunch');
    assert.equal(guessMeal(new Date(2026, 8, 20, 15, 0)), 'dinner');
    assert.equal(guessMeal(new Date(2026, 8, 20, 21, 0)), 'snack');
  });

  it('covers every hour of the day', () => {
    for (let h = 0; h < 24; h++) {
      assert.ok(MEALS.includes(guessMeal(at(h))), `hour ${h}`);
    }
  });
});

describe('projectWeight', () => {
  /** A clean run of readings losing `perWeek` kg a week from `start`. */
  const run = (start: number, perWeek: number, days: number, every = 1) => {
    const pts = [];
    for (let d = 0; d <= days; d += every) {
      pts.push({
        measuredOn: addDays('2026-01-01', d),
        weightKg: start + (perWeek / 7) * d,
      });
    }
    return pts;
  };
  const on = (d: number) => addDays('2026-01-01', d);

  it('reads the rate off the trend, not off the last two readings', () => {
    const p = projectWeight(run(85, -0.5, 56), 80, on(56));
    assert.equal(p.status, 'on-track');
    assert.ok(Math.abs(p.kgPerWeek - -0.5) < 0.01, `got ${p.kgPerWeek}`);
    assert.ok(Math.abs(p.currentKg - 81) < 0.01, `got ${p.currentKg}`);
  });

  it('dates the target from where the line is today', () => {
    // 81 kg today, losing 0.5/week, 1 kg to go -> about a fortnight.
    const p = projectWeight(run(85, -0.5, 56), 80, on(56));
    assert.equal(p.daysToTarget, 14);
    assert.equal(p.reachedOn, addDays(on(56), 14));
  });

  it('ignores a single noisy reading', () => {
    // A salty dinner on the last day would swing a two-point estimate wildly.
    const pts = run(85, -0.5, 56);
    (pts.at(-1) as { weightKg: number }).weightKg += 1.5;
    const p = projectWeight(pts, 80, on(56));
    assert.equal(p.status, 'on-track');
    assert.ok(Math.abs(p.kgPerWeek - -0.5) < 0.06, `got ${p.kgPerWeek}`);
  });

  it('projects gaining as readily as losing', () => {
    const p = projectWeight(run(60, 0.25, 56), 63, on(56));
    assert.equal(p.status, 'on-track');
    assert.ok(p.kgPerWeek > 0);
    assert.ok((p.daysToTarget as number) > 0);
  });

  it('refuses to date a target it is moving away from', () => {
    const p = projectWeight(run(85, 0.4, 56), 80, on(56));
    assert.equal(p.status, 'wrong-way');
    assert.equal(p.reachedOn, null);
    assert.ok(p.kgPerWeek > 0);
  });

  it('refuses to divide by a flat trend', () => {
    // Holding steady: the honest answer is "no date", not one in the year 3000.
    const p = projectWeight(run(85, 0, 56), 80, on(56));
    assert.equal(p.status, 'flat');
    assert.equal(p.daysToTarget, null);
  });

  it('says so when the target is already met', () => {
    // 80.8 kg losing 0.1/week for eight weeks lands the line on 80.0.
    const p = projectWeight(run(80.8, -0.1, 56), 80, on(56));
    assert.equal(p.status, 'reached');
  });

  it('counts sailing past the target as moving away from it', () => {
    // Below the goal and still dropping is not "reached" -- it is the point
    // at which someone should be told the trend no longer serves them.
    const p = projectWeight(run(80.05, -0.1, 56), 80, on(56));
    assert.equal(p.status, 'wrong-way');
    assert.ok(p.currentKg < 80);
  });

  it('will not fit a line to too few readings', () => {
    const sparse = [
      { measuredOn: '2026-01-01', weightKg: 85 },
      { measuredOn: '2026-02-01', weightKg: 83 },
    ];
    assert.equal(projectWeight(sparse, 80).status, 'insufficient');
  });

  it('will not fit a line to too short a span', () => {
    // Five readings in three days says nothing about a month from now.
    const p = projectWeight(run(85, -0.5, 3), 80, on(3));
    assert.equal(p.status, 'insufficient');
  });

  it('accepts readings in any order', () => {
    const forward = run(85, -0.5, 56, 3);
    const shuffled = [...forward].reverse();
    assert.deepEqual(
      projectWeight(shuffled, 80, on(56)),
      projectWeight(forward, 80, on(56)),
    );
  });

  it('keeps counting from today when logging stopped a while ago', () => {
    // Last entry three weeks ago: the line has kept going, so the estimate
    // should have moved on with it rather than freezing.
    const pts = run(85, -0.5, 56);
    const atLast = projectWeight(pts, 80, on(56));
    const later = projectWeight(pts, 80, on(77));
    assert.ok((later.currentKg as number) < (atLast.currentKg as number));
    assert.ok((later.daysToTarget as number) < (atLast.daysToTarget as number));
  });

  it('never returns a date it calls on-track without one', () => {
    for (const [target, rate] of [
      [80, -0.5],
      [90, 0.5],
      [85, 0],
    ] as const) {
      const p = projectWeight(run(85, rate, 56), target, on(56));
      if (p.status === 'on-track') {
        assert.ok(p.reachedOn && (p.daysToTarget as number) > 0);
      } else {
        assert.equal(p.reachedOn, p.status === 'reached' ? on(56) : null);
      }
    }
  });
});
