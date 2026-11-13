/**
 * The arithmetic behind weighing several things in a row: reading a run of
 * numbers as you type them, and deciding which of them a picked food gets.
 * Pure, so it can be tested without a browser.
 */

/** Grams the log accepts for one entry. */
const MIN_G = 1;
const MAX_G = 5000;

/**
 * Split typed weights into finished numbers and whatever is still being
 * typed.
 *
 * Anything that is not a digit separates -- space, comma, full stop, plus,
 * whatever the keyboard to hand offers. A phone's number pad often has no
 * space key but always has a comma or a full stop, and a kitchen scale reads
 * in whole grams, so there are no decimals worth keeping. The last number is
 * only finished once something follows it, so "45 1" yields 45 and leaves
 * "1" in the field for the 13 you are halfway through typing.
 */
export function splitWeights(text: string): { done: number[]; rest: string } {
  const parts = text.split(/\D+/);
  const rest = parts.pop() ?? '';
  return { done: parts.flatMap((t) => parseWeight(t) ?? []), rest };
}

/** One weight in whole grams, or null when it isn't one. */
export function parseWeight(token: string): number | null {
  const t = token.trim();
  if (!/^\d+$/.test(t)) return null;
  const g = Number.parseInt(t, 10);
  return g >= MIN_G && g <= MAX_G ? g : null;
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
