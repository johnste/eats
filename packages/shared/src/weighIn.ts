/**
 * The arithmetic behind weighing several things in a row: reading a run of
 * numbers as you type them, and deciding which of them a picked food gets.
 * Pure, so it can be tested without a browser.
 */

/** Grams the log accepts for one entry. */
const MIN_G = 0.1;
const MAX_G = 5000;

/**
 * Split typed weights into finished numbers and whatever is still being
 * typed.
 *
 * Space, `+`, `;` and newlines separate; a comma is a decimal mark, the way
 * Swedish scales and labels write it. The last token is only finished once a
 * separator follows it, so "45 1" yields 45 and leaves "1" in the field for
 * the 13 you are halfway through typing. Tokens that are not a usable weight
 * are dropped rather than kept as a chip nobody can pick a food for.
 */
export function splitWeights(text: string): { done: number[]; rest: string } {
  const parts = text.split(/[\s+;]+/);
  const rest = parts.pop() ?? '';
  return { done: parts.flatMap((t) => parseWeight(t) ?? []), rest };
}

/** One weight, or null when it isn't one. */
export function parseWeight(token: string): number | null {
  const t = token.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t) && !/^\.\d+$/.test(t)) return null;
  const g = Number.parseFloat(t);
  return Number.isFinite(g) && g >= MIN_G && g <= MAX_G ? g : null;
}

/**
 * How far a weight has to sit from the active one, in ratio terms, before a
 * food is given it instead. 1.5x: butter you usually have 10 g of goes to the
 * 12, not the 45, but a 30 g food does not get pulled off a 40 g slot onto a
 * 25 g one on the strength of a few grams.
 */
const CLEAR_MARGIN = Math.log(1.5);

/**
 * Which waiting weight a picked food should take.
 *
 * Weights usually arrive in the order you weighed them, and the active slot
 * is the next one in that order -- so that is the answer unless the food has
 * a usual amount and some other slot is clearly closer to it. A slot you
 * tapped yourself (`forced`) is always the answer: that was you saying so.
 */
export function pickSlot<T extends { id: string; grams: number }>(
  slots: readonly T[],
  activeId: string | null,
  usual: number | null,
  forced = false,
): T | null {
  const active = slots.find((s) => s.id === activeId) ?? slots[0] ?? null;
  if (!active || forced || !usual || usual <= 0) return active;

  const distance = (g: number) => Math.abs(Math.log(g / usual));
  let best = active;
  for (const s of slots) if (distance(s.grams) < distance(best.grams)) best = s;

  return distance(best.grams) + CLEAR_MARGIN < distance(active.grams) ? best : active;
}
