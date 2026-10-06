import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { AttemptLimiter } from '../src/lib/attempts.ts';
import { WORD_COUNT } from '../src/lib/passphrase.ts';
import {
  deleteArgs,
  isEditableDay,
  sameName,
  logArgs,
  moveArgs,
  searchArgs,
  TOOLS,
} from '../src/routes/mcp.ts';
import {
  generatePassphrase,
  MIN_SECRET_LENGTH,
  secretHint,
  secretProblem,
} from '../src/lib/tokens.ts';

describe('secret phrases', () => {
  it('suggests something a person can read out loud', () => {
    for (let i = 0; i < 200; i++) {
      const phrase = generatePassphrase();
      assert.match(phrase, /^[a-z]+-[a-z]+-[a-z]+$/);
      assert.ok(phrase.length >= MIN_SECRET_LENGTH, `${phrase} is too short`);
    }
  });

  it('draws on a list big enough that guessing is hopeless', () => {
    // Three words from this list, against 100 guesses an hour, is centuries.
    assert.ok(WORD_COUNT >= 400, `only ${WORD_COUNT} words`);
    assert.ok(Math.log2(WORD_COUNT ** 3) >= 25);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 200 }, () => generatePassphrase()));
    assert.ok(seen.size > 190, `${seen.size} distinct of 200`);
  });

  it('accepts a phrase a person chose themselves', () => {
    assert.equal(secretProblem('horse-lamp-river'), null);
    assert.equal(secretProblem('min hemliga fras'), null);
  });

  it('turns away a single word, however memorable', () => {
    // The whole point of the change: "horse" is what someone would pick, and
    // it is also inside the first thousand guesses anyone would make.
    assert.ok(secretProblem('horse'));
    assert.ok(secretProblem('hus'));
    assert.ok(secretProblem('   horse   '));
  });

  it('turns away what everyone tries first', () => {
    for (const bad of ['password', 'letmein', 'changeme', 'opensesame']) {
      assert.ok(secretProblem(bad), `${bad} should be refused`);
    }
    assert.ok(secretProblem('aaaaaaaaaaaaaaa'));
  });

  it('hints at a secret without giving it away', () => {
    const hint = secretHint('orchard-totem-rust');
    assert.ok(hint.startsWith('orchard'));
    assert.ok(!hint.includes('totem'));
    assert.ok(!hint.includes('rust'));
  });
});

describe('failed-attempt limiter', () => {
  const at = (t: number) => {
    let now = t;
    return {
      limiter: new AttemptLimiter(() => now),
      set: (v: number) => (now = v),
    };
  };

  it('lets an honest mistake through', () => {
    const { limiter } = at(0);
    limiter.fail('1.1.1.1');
    assert.equal(limiter.blocked('1.1.1.1'), false);
  });

  it('shuts an address down once it is clearly guessing', () => {
    const { limiter } = at(0);
    for (let i = 0; i < 10; i++) limiter.fail('1.1.1.1');
    assert.equal(limiter.blocked('1.1.1.1'), true);
  });

  it('does not punish an address for someone else guessing', () => {
    const { limiter } = at(0);
    for (let i = 0; i < 10; i++) limiter.fail('1.1.1.1');
    assert.equal(limiter.blocked('2.2.2.2'), false);
  });

  it('stops a distributed attack that spreads itself thin', () => {
    // Nine guesses each, under the per-address limit every time, from a
    // hundred different addresses. Only the global budget catches this.
    const { limiter } = at(0);
    for (let host = 0; host < 100; host++) {
      for (let i = 0; i < 9; i++) limiter.fail(`10.0.0.${host}`);
    }
    assert.equal(limiter.blocked('10.0.99.99'), true);
  });

  it('forgives after an hour', () => {
    const { limiter, set } = at(0);
    for (let i = 0; i < 10; i++) limiter.fail('1.1.1.1');
    assert.equal(limiter.blocked('1.1.1.1'), true);
    set(60 * 60 * 1000 + 1);
    assert.equal(limiter.blocked('1.1.1.1'), false);
  });

  it('says how long to wait, and never says zero', () => {
    const { limiter, set } = at(1_000_000);
    for (let i = 0; i < 10; i++) limiter.fail('1.1.1.1');
    const wait = limiter.retryAfter('1.1.1.1');
    assert.ok(wait > 0 && wait <= 3600, `got ${wait}`);
    set(1_000_000 + 59 * 60 * 1000);
    assert.ok(limiter.retryAfter('1.1.1.1') <= 60);
  });

  it('does not grow without bound under a flood of new addresses', () => {
    const { limiter } = at(0);
    for (let i = 0; i < 20_000; i++) limiter.fail(`10.${i >> 8}.${i & 255}.1`);
    // The global budget is spent regardless, which is the point.
    assert.equal(limiter.blocked('9.9.9.9'), true);
  });
});

describe('mcp tool arguments', () => {
  it('accepts logging an existing food by id', () => {
    const parsed = logArgs.safeParse({
      foodId: '550e8400-e29b-41d4-a716-446655440000',
      grams: 60,
      meal: 'breakfast',
    });
    assert.ok(parsed.success);
  });

  it('accepts a food not in the database when macros come with it', () => {
    const parsed = logArgs.safeParse({
      name: 'Kanelbulle från fiket',
      grams: 85,
      meal: 'snack',
      kcal100g: 380,
      protein100g: 7,
      carbs100g: 52,
      fat100g: 15,
    });
    assert.ok(parsed.success);
  });

  it('rejects a meal the app does not have', () => {
    assert.ok(!logArgs.safeParse({ grams: 60, meal: 'brunch' }).success);
  });

  it('rejects portions that would poison the day total', () => {
    // An agent misreading kg as g is the realistic failure here.
    for (const grams of [0, -60, 9000]) {
      assert.ok(
        !logArgs.safeParse({ grams, meal: 'lunch' }).success,
        `${grams} g should be rejected`,
      );
    }
  });

  it('rejects macros outside what food can physically be', () => {
    const base = { name: 'Impossible', grams: 100, meal: 'lunch' };
    assert.ok(!logArgs.safeParse({ ...base, kcal100g: 5000 }).success);
    assert.ok(!logArgs.safeParse({ ...base, fat100g: 150 }).success);
    assert.ok(!logArgs.safeParse({ ...base, protein100g: -1 }).success);
  });

  it('requires something to search for', () => {
    assert.ok(!searchArgs.safeParse({ query: '' }).success);
    assert.ok(searchArgs.safeParse({ query: 'havregryn' }).success);
  });
});

describe('mcp tool declarations', () => {
  it('describes every tool well enough for an agent to use it unprompted', () => {
    assert.deepEqual(
      TOOLS.map((t) => t.name),
      [
        'search_foods',
        'log_food',
        'get_day',
        'move_entry',
        'find_duplicates',
        'merge_foods',
        'delete_entry',
      ],
    );
    for (const tool of TOOLS) {
      assert.ok(tool.description.length > 80, `${tool.name} needs a real description`);
      assert.equal(tool.inputSchema.type, 'object');
      for (const [field, schema] of Object.entries(tool.inputSchema.properties)) {
        assert.ok(
          (schema as { description?: string }).description,
          `${tool.name}.${field} needs a description`,
        );
      }
    }
  });

  it('only demands the arguments that have no sensible default', () => {
    const required = Object.fromEntries(
      TOOLS.map((t) => [
        t.name,
        (t.inputSchema as { required?: readonly string[] }).required ?? [],
      ]),
    );
    assert.deepEqual(required.search_foods, ['query']);
    // Neither foodId nor name is required: one or the other is checked at
    // call time, which a JSON Schema `required` list cannot express.
    assert.deepEqual(required.log_food, ['grams', 'meal']);
    // Defaults to today, which is the whole point of the tool.
    assert.deepEqual(required.get_day, []);
    // Both editing tools need to be told what to act on, and nothing else.
    assert.deepEqual(required.move_entry, ['entryId']);
    assert.deepEqual(required.delete_entry, ['entryId']);
    // Nothing to ask for: it reports what it finds.
    assert.deepEqual(required.find_duplicates, []);
    // Both halves, because guessing either one would merge the wrong food.
    assert.deepEqual(required.merge_foods, ['sourceId', 'targetId']);
  });
});

describe('what an agent may edit', () => {
  const today = '2026-09-25';

  it('allows today and yesterday', () => {
    assert.ok(isEditableDay('2026-09-25', today));
    assert.ok(isEditableDay('2026-09-24', today));
  });

  it('refuses anything older', () => {
    // An agent correcting a mistake is working from what it remembers of the
    // conversation. Past yesterday that is a guess, and a guess should not be
    // allowed to rewrite a day.
    for (const old of ['2026-09-23', '2026-09-01', '2025-12-31']) {
      assert.equal(isEditableDay(old, today), false, old);
    }
  });

  it('refuses the future', () => {
    assert.equal(isEditableDay('2026-09-26', today), false);
  });

  it('crosses a month boundary correctly', () => {
    assert.ok(isEditableDay('2026-08-31', '2026-09-01'));
    assert.equal(isEditableDay('2026-08-30', '2026-09-01'), false);
  });

  it('crosses a year boundary correctly', () => {
    assert.ok(isEditableDay('2025-12-31', '2026-01-01'));
    assert.equal(isEditableDay('2025-12-30', '2026-01-01'), false);
  });
});

describe('move and delete arguments', () => {
  const id = '550e8400-e29b-41d4-a716-446655440000';

  it('moves an entry to another meal', () => {
    assert.ok(moveArgs.safeParse({ entryId: id, meal: 'breakfast' }).success);
  });

  it('takes any one correction on its own', () => {
    for (const change of [{ meal: 'lunch' }, { date: '2026-09-24' }, { grams: 80 }]) {
      assert.ok(moveArgs.safeParse({ entryId: id, ...change }).success);
    }
  });

  it('rejects a date that is not a date', () => {
    assert.ok(!moveArgs.safeParse({ entryId: id, date: 'yesterday' }).success);
    assert.ok(!moveArgs.safeParse({ entryId: id, date: '25/09/2026' }).success);
  });

  it('rejects an entry id that is not one', () => {
    assert.ok(!moveArgs.safeParse({ entryId: '42' }).success);
    assert.ok(!deleteArgs.safeParse({ entryId: '' }).success);
  });

  it('rejects a correction that would poison the total', () => {
    assert.ok(!moveArgs.safeParse({ entryId: id, grams: 0 }).success);
    assert.ok(!moveArgs.safeParse({ entryId: id, grams: 9000 }).success);
  });

  it('lets log_food name a day, within the same rule', () => {
    assert.ok(
      logArgs.safeParse({ grams: 60, meal: 'lunch', date: '2026-09-24' }).success,
    );
    assert.ok(!logArgs.safeParse({ grams: 60, meal: 'lunch', date: 'nope' }).success);
  });
});

describe('duplicate foods', () => {
  it('treats case and spacing as the same food', () => {
    assert.ok(sameName('Havregryn', 'havregryn'));
    assert.ok(sameName('  Havregryn  ', 'Havregryn'));
    assert.ok(sameName('Kaffe med  mjolk', 'kaffe med mjolk'));
  });

  it('leaves genuinely different names alone', () => {
    assert.equal(sameName('Havregryn', 'Havregryn fullkorn'), false);
    assert.equal(sameName('Agg kokt', 'Agg stekt'), false);
    assert.equal(sameName('Mjolk', 'Mjolkchoklad'), false);
  });

  it('does not fold accents together', () => {
    // Merging two foods cannot be undone, and "Agg" being the same word as
    // "Agg" with a ring on it is a guess rather than a fact.
    assert.equal(sameName('\u00c4gg', 'Agg'), false);
  });

  it('accepts createNew as the way past a refusal', () => {
    const base = {
      grams: 60,
      meal: 'lunch',
      name: 'Havregryn',
      kcal100g: 375,
      protein100g: 9.5,
      carbs100g: 64,
      fat100g: 7,
    };
    assert.ok(logArgs.safeParse(base).success);
    assert.ok(logArgs.safeParse({ ...base, createNew: true }).success);
    assert.ok(!logArgs.safeParse({ ...base, createNew: 'yes' }).success);
  });
});
