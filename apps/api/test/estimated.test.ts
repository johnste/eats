import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { stripEstimateMarker } from '@eats/shared';

/**
 * Real names from the food log, as an agent wrote them. Migration 0008 is
 * checked against the same list (see the migration's own comment), so the
 * SQL and this function cannot drift apart unnoticed.
 */
export const CASES: [string, string, boolean][] = [
  ['Ballerinakaka (estimated)', 'Ballerinakaka', true],
  ['Pasta, kokt (uppskattad)', 'Pasta, kokt', true],
  ['Beyond Burger, patty (estimated)', 'Beyond Burger, patty', true],
  ["Bran Flakes (Kellogg's, uppskattad)", "Bran Flakes (Kellogg's)", true],
  ['Gräddig tomatsås (hemgjord, uppskattad)', 'Gräddig tomatsås (hemgjord)', true],
  ['Soppa (uppskattad, hemgjord)', 'Soppa (hemgjord)', true],
  ['Mix (a, estimated, b)', 'Mix (a, b)', true],
  ['Kaka (Estimated)', 'Kaka', true],
  ['Kaka (est.)', 'Kaka', true],
  ['Gröt (uppskattat)', 'Gröt', true],
  ['Estrella chips', 'Estrella chips', false],
  ['Gräddig tomatsås (hemgjord)', 'Gräddig tomatsås (hemgjord)', false],
  ['Kaffe, estimated', 'Kaffe, estimated', false],
  ['Levain', 'Levain', false],
  ['Kaffe, estimated, extra', 'Kaffe, estimated, extra', false],
  ['Soppa ( uppskattad )', 'Soppa', true],
  ['A (estimated) (hemgjord)', 'A (hemgjord)', true],
];

describe('stripEstimateMarker', () => {
  for (const [input, name, estimated] of CASES) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(name)}`, () => {
      assert.deepEqual(stripEstimateMarker(input), { name, estimated });
    });
  }
});
