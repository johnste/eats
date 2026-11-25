/**
 * Ranking the foods offered before you type anything. Pure, so it can be
 * tested without a database or a browser.
 *
 * Three things say what you are about to reach for:
 *
 * - Habit: how often this meal has had it. Oats at breakfast, most days.
 * - What is on the plate already: with the bread in, butter and cheese.
 *   Before anything is in, what you usually start this meal with stands in.
 * - The weights waiting for a food: 250 g is the yoghurt, not the honey. A
 *   food whose usual amount sits near the next weight is very likely the
 *   next food.
 */

import type { SuggestResponse, SuggestedFood } from './schemas.ts';

/** How many suggestions are worth a glance before you would rather search. */
export const MAX_SUGGESTIONS = 6;

/**
 * Seen together or at this meal fewer times than this and it is a one-off,
 * not a habit; the recents list below already has it.
 */
const MIN_TIMES = 2;

/**
 * Pulls small samples towards nothing: one breakfast out of one is not
 * "always", and should not outrank seven out of ten.
 */
const PRIOR = 2;

/**
 * How far, in ratio terms, a weight can sit from a food's usual amount and
 * still look like it. Within about a third either way counts as a match --
 * a portion is never weighed out to the gram the same twice.
 */
const FIT_SPREAD = Math.log(1.4);

/**
 * When a weight is waiting, a food with no usual amount can't be matched to
 * it: neither a good fit nor a bad one.
 */
const UNKNOWN_FIT = 0.35;

/** A weight that isn't the next one still counts, but less. */
const OTHER_SLOT = 0.6;

const rate = (n: number, of: number) => n / (of + PRIOR);

/** How much a food usually weighs on the scale: your usual, or its portion. */
export const usualAmount = (food: {
  usualGrams?: number | null | undefined;
  servings: readonly { grams: number }[];
}): number | null => food.usualGrams ?? food.servings[0]?.grams ?? null;

/** 1 for the same weight, falling smoothly towards 0 as they part. */
export function weightFit(grams: number, usual: number): number {
  const d = Math.log(grams / usual) / FIT_SPREAD;
  return Math.exp(-(d * d) / 2);
}

/**
 * How well a food matches the weights still waiting: its best fit, with the
 * next weight in line counting fully and any other somewhat less. Null with
 * nothing waiting, when weight says nothing either way.
 */
export function slotFit(
  usual: number | null,
  grams: readonly number[],
  activeIndex = 0,
): number | null {
  if (grams.length === 0) return null;
  if (!usual || usual <= 0) return UNKNOWN_FIT;
  let best = 0;
  grams.forEach((g, i) => {
    const fit = weightFit(g, usual) * (i === activeIndex ? 1 : OTHER_SLOT);
    if (fit > best) best = fit;
  });
  return best;
}

export interface SuggestContext {
  /** Weights waiting for a food, in order. */
  grams: readonly number[];
  /** Which of them the next pick goes to. */
  activeIndex?: number;
  /** Foods to leave out: already picked on this visit. */
  exclude?: readonly string[];
}

/** One food's score from its history alone, before any weight is considered. */
export function historyScore(
  food: Pick<SuggestedFood, 'meals' | 'first' | 'together'>,
  data: Pick<SuggestResponse, 'mealDays' | 'contextMeals' | 'context'>,
): number {
  const habit = rate(food.meals, data.mealDays);
  if (data.context.length === 0) {
    // Nothing in yet: what you start with matters most, and what this meal
    // has in general a little.
    return 0.6 * rate(food.first, data.mealDays) + 0.4 * habit;
  }
  // Something in already: what goes with it, then habit. Habit still counts
  // for a lot, because the meal you started is still breakfast.
  return 0.65 * rate(food.together, data.contextMeals) + 0.35 * habit;
}

/**
 * The foods to offer, best first. A food has to have been a habit or a
 * companion at least twice to be offered at all; past that, its history
 * score is scaled by how well it fits the weights waiting, so typing "250"
 * brings the yoghurt up and sends the honey down.
 */
export function rankSuggestions(
  data: SuggestResponse,
  ctx: SuggestContext,
): SuggestedFood[] {
  const exclude = new Set(ctx.exclude);
  return data.foods
    .filter((f) => !exclude.has(f.id))
    .filter((f) =>
      data.context.length === 0
        ? f.meals >= MIN_TIMES
        : f.together >= MIN_TIMES || f.meals >= MIN_TIMES,
    )
    .map((f) => {
      const fit = slotFit(usualAmount(f), ctx.grams, ctx.activeIndex);
      const score = historyScore(f, data) * (fit === null ? 1 : 0.25 + 0.75 * fit);
      return { f, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.f);
}
