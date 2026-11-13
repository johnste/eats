import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseWeight, pickSlot, splitWeights } from '@eats/shared';

describe('splitWeights', () => {
  it('finishes every number a separator follows, and leaves the last alone', () => {
    assert.deepEqual(splitWeights('45 13 1'), { done: [45, 13], rest: '1' });
    assert.deepEqual(splitWeights('45 13 12 '), { done: [45, 13, 12], rest: '' });
  });

  it('reads a comma as a decimal mark, not a separator', () => {
    assert.deepEqual(splitWeights('12,5 '), { done: [12.5], rest: '' });
  });

  it('accepts plus and semicolons, and runs of separators', () => {
    assert.deepEqual(splitWeights('45+13;;12  '), { done: [45, 13, 12], rest: '' });
  });

  it('drops tokens that are not a weight', () => {
    assert.deepEqual(splitWeights('45 abc 0 9000 13 '), { done: [45, 13], rest: '' });
  });
});

describe('parseWeight', () => {
  it('takes either decimal mark', () => {
    assert.equal(parseWeight('12.5'), 12.5);
    assert.equal(parseWeight('12,5'), 12.5);
  });

  it('refuses nothing, zero and the absurd', () => {
    assert.equal(parseWeight(''), null);
    assert.equal(parseWeight('0'), null);
    assert.equal(parseWeight('6000'), null);
    assert.equal(parseWeight('1e3'), null);
  });
});

describe('pickSlot', () => {
  const slots = [
    { id: 'a', grams: 45 },
    { id: 'b', grams: 13 },
    { id: 'c', grams: 12 },
  ];

  it('takes the active slot when the food has no usual amount', () => {
    assert.equal(pickSlot(slots, 'a', null)?.id, 'a');
  });

  it('falls back to the first slot when none is active', () => {
    assert.equal(pickSlot(slots, null, null)?.id, 'a');
    assert.equal(pickSlot(slots, 'gone', null)?.id, 'a');
  });

  it('moves a food to a slot clearly closer to its usual amount', () => {
    // Butter, usually 10 g, picked while the bread's 45 is active.
    assert.equal(pickSlot(slots, 'a', 10)?.id, 'c');
  });

  it('stays on the active slot when the usual amount fits it', () => {
    assert.equal(pickSlot(slots, 'a', 50)?.id, 'a');
  });

  it('stays on the active slot when the alternative is only a little closer', () => {
    // 40 vs 30 for a 33 g food: closer, but not clearly enough to skip ahead.
    const near = [
      { id: 'x', grams: 40 },
      { id: 'y', grams: 30 },
    ];
    assert.equal(pickSlot(near, 'x', 33)?.id, 'x');
  });

  it('always honours a slot you tapped yourself', () => {
    assert.equal(pickSlot(slots, 'a', 10, true)?.id, 'a');
  });

  it('has nothing to give when no weights are waiting', () => {
    assert.equal(pickSlot([], null, 10), null);
  });
});
